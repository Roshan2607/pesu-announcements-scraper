import { createWorker } from 'tesseract.js';

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

export class OcrService {
  private worker: any = null;
  private isInitializing = false;

  async getWorker() {
    if (this.worker) return this.worker;
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return this.worker;
    }

    try {
      this.isInitializing = true;
      this.worker = await createWorker('eng');
      this.isInitializing = false;
      return this.worker;
    } catch (err) {
      this.isInitializing = false;
      console.warn('[OcrService] Worker initialization error:', err);
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
   * Safely downloads an image with strict domain whitelisting, size limits, and timeouts.
   */
  private async safeFetchImageBuffer(url: string): Promise<Buffer | null> {
    if (!this.isUrlAllowed(url)) {
      console.warn(`[OcrService] Rejected poster URL outside approved domains: ${url}`);
      return null;
    }

    if (url.startsWith('data:image/')) {
      const base64Data = url.split(',')[1];
      if (!base64Data) return null;
      const buf = Buffer.from(base64Data, 'base64');
      if (buf.length > MAX_IMAGE_SIZE_BYTES) {
        console.warn(`[OcrService] Inline image exceeds max size limit (${buf.length} bytes)`);
        return null;
      }
      return buf;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        console.warn(`[OcrService] Poster fetch returned HTTP ${resp.status}`);
        return null;
      }

      const contentLength = resp.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE_BYTES) {
        console.warn(`[OcrService] Poster exceeds max size limit (${contentLength} bytes)`);
        return null;
      }

      const arrayBuf = await resp.arrayBuffer();
      const buf = Buffer.from(arrayBuf);

      if (buf.length > MAX_IMAGE_SIZE_BYTES) {
        console.warn(`[OcrService] Downloaded image exceeds limit (${buf.length} bytes)`);
        return null;
      }

      return buf;
    } catch (err: any) {
      clearTimeout(timeout);
      console.warn(`[OcrService] Failed to download poster safely: ${err.message}`);
      return null;
    }
  }

  /**
   * Run OCR on a validated image with strict timeouts and resource limits.
   */
  async extractText(imageInput: string | Buffer): Promise<string> {
    if (!imageInput) return '';

    try {
      let imageBuffer: Buffer | string | null = null;

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
      return (result?.data?.text || '').trim();
    } catch (error: any) {
      console.warn('[OcrService] OCR recognition error:', error.message || error);
      return '';
    }
  }

  async terminate() {
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
