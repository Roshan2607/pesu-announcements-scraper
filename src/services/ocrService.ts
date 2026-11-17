import { createWorker } from 'tesseract.js';

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
   * Run OCR on an image URL, base64 string, or local buffer.
   */
  async extractText(imageInput: string | Buffer): Promise<string> {
    if (!imageInput) return '';

    try {
      const worker = await this.getWorker();
      if (!worker) {
        console.warn('[OcrService] Worker unavailable, skipping OCR.');
        return '';
      }

      const result = await worker.recognize(imageInput);
      return (result?.data?.text || '').trim();
    } catch (error) {
      console.warn('[OcrService] OCR recognition failed:', error);
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
