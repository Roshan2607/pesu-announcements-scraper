import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { PesuAuthSession } from './pesuAuthSession.js';
import { ocrService } from './ocrService.js';
import { classifyAnnouncement } from './classifier.js';
import {
  ClassifiedHackathon,
  QuackathonAnnouncementEnvelope,
  RawPesuAnnouncement,
} from '../types.js';

export interface ScraperOptions {
  enableOcr?: boolean;
  maxAnnouncements?: number;
  htmlFixture?: string; // For testing or offline fixture execution
}

export class AnnouncementScraper {
  private session: PesuAuthSession;
  private academyAdminUrl = 'https://www.pesuacademy.com/Academy/s/studentProfilePESUAdmin';

  constructor(session?: PesuAuthSession) {
    this.session = session || new PesuAuthSession();
  }

  /**
   * Generates a stable, deterministic announcement ID based on content hash.
   * Ensures idempotency across repeated scraper runs and service restarts.
   */
  public generateStableId(title: string, date: string, rawElementId?: string | null): string {
    if (rawElementId && rawElementId.trim()) {
      return `pesu_ann_${rawElementId.trim().replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    }

    const normalizedKey = `${title.toLowerCase().trim()}|${date.toLowerCase().trim()}`;
    const hash = crypto.createHash('sha256').update(normalizedKey).digest('hex').substring(0, 16);
    return `pesu_ann_${hash}`;
  }

  /**
   * Parse HTML content into RawPesuAnnouncement objects
   */
  async parseAnnouncementsHtml(
    html: string,
    options: ScraperOptions = {}
  ): Promise<RawPesuAnnouncement[]> {
    const $ = cheerio.load(html);
    const announcements: RawPesuAnnouncement[] = [];
    const elements = $('.elem-info-wrapper').toArray();

    const maxItems = options.maxAnnouncements || elements.length;
    const targetElements = elements.slice(0, maxItems);

    for (let idx = 0; idx < targetElements.length; idx++) {
      const box = $(targetElements[idx]);

      // 1. Extract Title
      const title =
        box.find('.text-info').text().trim() ||
        box.find('h4, h3, strong').first().text().trim() ||
        'Untitled Announcement';

      // 2. Extract Date
      const date =
        box.find('.text-date, .text-muted.pull-right').text().trim() ||
        box.find('.text-muted').text().trim() ||
        '';

      // 3. Extract Body paragraphs
      const bodyContainer = box.find('.col-md-12, .col-md-8, .elem-content').first();
      let bodyText = '';
      if (bodyContainer.length) {
        bodyText = bodyContainer
          .find('p, span')
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(Boolean)
          .join('\n');
        if (!bodyText) {
          bodyText = bodyContainer.text().trim();
        }
      } else {
        bodyText = box.text().trim();
      }

      // 4. Extract Poster / Flyer Image
      const imgElem = box.find('img.img-responsive, img').first();
      let posterUrl: string | null = imgElem.attr('src') || null;
      if (posterUrl && posterUrl.startsWith('/')) {
        posterUrl = `https://www.pesuacademy.com${posterUrl}`;
      }

      // 5. Extract Attachment count & check for existing IDs
      const downloadLinks = box.find('.pesu-ico-download, a[href*="download"]');
      const attachments = downloadLinks.length;
      let rawId: string | null = box.attr('id') || null;
      if (!rawId && downloadLinks.length > 0) {
        const href = downloadLinks.first().attr('href') || '';
        const matchId = href.match(/\/(\d+)(?:\.[a-zA-Z0-9]+)?$/);
        if (matchId) {
          rawId = matchId[1];
        }
      }

      // 6. Run Tesseract OCR on Poster Flyer if present & enabled
      let ocrText = '';
      if (options.enableOcr !== false && posterUrl) {
        try {
          console.log(`[Scraper] Running Tesseract OCR on flyer for: "${title.slice(0, 30)}..."`);
          ocrText = await ocrService.extractText(posterUrl);
          if (ocrText) {
            console.log(`[Scraper] OCR extracted ${ocrText.length} characters.`);
          }
        } catch (ocrErr) {
          console.warn(`[Scraper] OCR extraction skipped for ${title}:`, ocrErr);
        }
      }

      // Deterministic, stable ID
      const stableId = this.generateStableId(title, date, rawId);

      announcements.push({
        id: stableId,
        title,
        date,
        description: bodyText,
        image: posterUrl,
        attachments,
        ocrText: ocrText || null,
      });
    }

    return announcements;
  }

  /**
   * Complete pipeline: Authenticates via Spring Security, fetches announcements HTML
   * from studentProfilePESUAdmin, runs OCR on posters, and formats into Quackathon envelope.
   */
  async fetchEnvelope(options: ScraperOptions = {}): Promise<QuackathonAnnouncementEnvelope> {
    let htmlContent = options.htmlFixture || '';

    if (!htmlContent) {
      const isAuth = await this.session.ensureAuthenticated();
      if (!isAuth) {
        throw new Error('Failed to authenticate with PESU Academy.');
      }

      const params = new URLSearchParams({
        menuId: '667',
        controllerMode: '6411',
        actionType: '5',
        id: '0',
        selectedData: '0',
      });

      const resp = await fetch(`${this.academyAdminUrl}?${params.toString()}`, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
          'X-CSRF-Token': this.session.getAuthCsrfToken() || '',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: 'https://www.pesuacademy.com/Academy/s/studentProfilePESU',
          Cookie: this.session.getCookieHeader(),
        },
      });

      if (!resp.ok) {
        throw new Error(`PESU Academy returned status ${resp.status} ${resp.statusText}`);
      }

      htmlContent = await resp.text();
    }

    const rawData = await this.parseAnnouncementsHtml(htmlContent, options);

    return {
      resource: 'announcements',
      fetched_at: new Date().toISOString(),
      data: rawData,
    };
  }

  /**
   * High-level method that returns both the Quackathon envelope and classified events
   */
  async getEventsPipeline(options: ScraperOptions = {}): Promise<{
    envelope: QuackathonAnnouncementEnvelope;
    allClassified: ClassifiedHackathon[];
    hackathons: ClassifiedHackathon[];
  }> {
    const envelope = await this.fetchEnvelope(options);
    const allClassified = envelope.data.map(classifyAnnouncement);
    const hackathons = allClassified.filter((e) => e.isHackathon);

    return {
      envelope,
      allClassified,
      hackathons,
    };
  }
}
