import { createWorker, Worker } from 'tesseract.js';

const ALLOWED_IMAGE_DOMAINS = [
  'www.pesuacademy.com',
  'pesuacademy.com',
  'files.pesuacademy.com',
  // Allow placeholder domains only in test mode
  ...(process.env.NODE_ENV === 'test' ? ['via.placeholder.com'] : []),
];

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const OCR_TIMEOUT_MS = 12000; // 12 seconds max for OCR recognition
const FETCH_TIMEOUT_MS = 6000; // 6 seconds max for image download
const WORKER_IDLE_TIMEOUT_MS = 45000; // 45 seconds auto-termination for memory release

export class OcrService {
  private worker: Worker | null = null;
  private isInitializing = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private queue: Promise<any> = Promise.resolve(); // Simple FIFO queue for concurrency throttling

  /**
   * Resets the idle timer. Worker auto-terminates after 45s of inactivity.
   */
  private touchIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.terminate().catch(() => {});
    }, WORKER_IDLE_TIMEOUT_MS);
  }

  async getWorker(): Promise<Worker | null> {
    this.touchIdleTimer();

    if (this.worker) return this.worker;
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return this.worker;
    }

    try {
      this.isInitializing = true;
      const worker = await createWorker('eng');
      this.worker = worker;
      this.isInitializing = false;
      return this.worker;
    } catch (err: any) {
      this.isInitializing = false;
      console.warn('[OcrService] Worker initialization error:', err.message || err);
      return null;
    }
  }

  /**
   * Validates that an image URL is from an approved, safe PESU origin (SSRF protection).
   */
  public isUrlAllowed(urlStr: string): boolean {
    if (urlStr.startsWith('data:image/')) {
      return true; // Inline base64 image data
    }

    try {
      const parsed = new URL(urlStr);
      if (parsed.protocol !== 'https:') {
        return false; // Strictly enforce HTTPS
      }
      return ALLOWED_IMAGE_DOMAINS.includes(parsed.hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  /**
   * Validates magic bytes to ensure payload is genuinely an image (PNG, JPEG, WEBP, GIF).
   * Prevents HTML error pages or arbitrary text/binaries from reaching Tesseract.
   */
  public isValidImageBuffer(buf: Buffer): boolean {
    if (!buf || buf.length < 12) return false;

    // PNG: 89 50 4E 47
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    // JPEG: FF D8 FF
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    // WEBP: RIFF ... WEBP
    const isWebp =
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP';
    // GIF: GIF87a or GIF89a
    const isGif = buf.subarray(0, 3).toString('ascii') === 'GIF';

    return isPng || isJpeg || isWebp || isGif;
  }

  /**
   * Safely downloads an image with strict domain whitelisting, size limits, and timeouts.
   */
  private async safeFetchImageBuffer(url: string): Promise<Buffer | null> {
    if (!this.isUrlAllowed(url)) {
      console.warn(`[OcrService] Rejected poster URL outside approved domains: ${url}`);
      return null;
    }

    if (url.startsWith('data:image/')) {
      const commaIndex = url.indexOf(',');
      if (commaIndex === -1) return null;
      const base64Data = url.slice(commaIndex + 1);
      const buf = Buffer.from(base64Data, 'base64');

      if (buf.length > MAX_IMAGE_SIZE_BYTES) {
        console.warn(`[OcrService] Inline image exceeds max size limit (${buf.length} bytes)`);
        return null;
      }
      if (!this.isValidImageBuffer(buf)) {
        console.warn('[OcrService] Inline image has invalid image magic bytes');
        return null;
      }
      return buf;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      let currentUrl = url;
      let redirectHops = 0;
      const maxRedirects = 3;
      let resp: Response | null = null;

      while (redirectHops <= maxRedirects) {
        resp = await fetch(currentUrl, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'image/png,image/jpeg,image/webp,*/*',
          },
        });

        // Validate redirects and ensure target remains within allowed domains
        if ([301, 302, 303, 307, 308].includes(resp.status)) {
          redirectHops++;
          const location = resp.headers.get('location');
          if (!location) {
            console.warn(`[OcrService] Redirect response missing location header for: ${currentUrl}`);
            return null;
          }
          const nextUrl = new URL(location, currentUrl).toString();
          if (!this.isUrlAllowed(nextUrl)) {
            console.warn(`[OcrService] Blocked redirect to unapproved URL: ${nextUrl}`);
            return null;
          }
          currentUrl = nextUrl;
          continue;
        }

        break;
      }

      if (!resp || !resp.ok) {
        console.warn(`[OcrService] Poster fetch returned HTTP ${resp?.status || 'no-response'}`);
        return null;
      }

      const contentLength = resp.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE_BYTES) {
        console.warn(`[OcrService] Poster exceeds max size limit (${contentLength} bytes)`);
        return null;
      }

      if (!resp.body) {
        return null;
      }

      // Stream chunks while enforcing 5MB limit incrementally
      const reader = resp.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytesRead = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          bytesRead += value.length;
          if (bytesRead > MAX_IMAGE_SIZE_BYTES) {
            console.warn(`[OcrService] Download stream exceeded 5MB limit (${bytesRead} bytes); aborted.`);
            await reader.cancel('Max image size exceeded');
            return null;
          }
          chunks.push(value);
        }
      }

      const buf = Buffer.concat(chunks);

      if (!this.isValidImageBuffer(buf)) {
        console.warn('[OcrService] Downloaded response is not a valid image format (magic bytes check failed)');
        return null;
      }

      return buf;
    } catch (err: any) {
      console.warn(`[OcrService] Failed to download poster safely: ${err.message}`);
      return null;
    } finally {
      // Keep timeout armed through entire download stream; clear only on completion or failure
      clearTimeout(timeout);
    }
  }

  /**
   * Run OCR on a validated image with serialization queue, strict timeouts and resource limits.
   */
  async extractText(imageInput: string | Buffer): Promise<string> {
    if (!imageInput) return '';

    // Enqueue OCR request so jobs run sequentially without pinning CPU/memory
    const executeJob = async (): Promise<string> => {
      try {
        let imageBuffer: Buffer | null = null;

        if (typeof imageInput === 'string') {
          imageBuffer = await this.safeFetchImageBuffer(imageInput);
          if (!imageBuffer) {
            return '';
          }
        } else {
          if (imageInput.length > MAX_IMAGE_SIZE_BYTES) {
            console.warn('[OcrService] Image buffer exceeds size limit');
            return '';
          }
          if (!this.isValidImageBuffer(imageInput)) {
            console.warn('[OcrService] Image buffer failed magic bytes validation');
            return '';
          }
          imageBuffer = imageInput;
        }

        const worker = await this.getWorker();
        if (!worker) {
          return '';
        }

        // Enforce recognition timeout
        const recognitionPromise = worker.recognize(imageBuffer);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Tesseract OCR execution timed out')), OCR_TIMEOUT_MS)
        );

        const result: any = await Promise.race([recognitionPromise, timeoutPromise]);
        this.touchIdleTimer();
        return (result?.data?.text || '').trim();
      } catch (error: any) {
        console.warn('[OcrService] OCR recognition error:', error.message || error);
        return '';
      }
    };

    // Serialize execution
    this.queue = this.queue.then(executeJob, executeJob);
    return this.queue;
  }

  async terminate() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch (err) {
        // ignore
      }
      this.worker = null;
    }
  }
}

export const ocrService = new OcrService();
