import cron from 'node-cron';
import { AnnouncementScraper, ScraperOptions } from './announcementScraper.js';
import { ClassifiedHackathon, QuackathonAnnouncementEnvelope } from '../types.js';

export interface SyncStatus {
  lastSyncAt: string | null;
  isSyncing: boolean;
  totalAnnouncements: number;
  totalHackathons: number;
  lastError: string | null;
}

export class CronScheduler {
  private scraper: AnnouncementScraper;
  private cronJob: cron.ScheduledTask | null = null;
  private cachedEnvelope: QuackathonAnnouncementEnvelope | null = null;
  private cachedHackathons: ClassifiedHackathon[] = [];
  private isSyncing = false;
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;

  constructor(scraper = new AnnouncementScraper()) {
    this.scraper = scraper;
  }

  public getStatus(): SyncStatus {
    return {
      lastSyncAt: this.lastSyncAt,
      isSyncing: this.isSyncing,
      totalAnnouncements: this.cachedEnvelope?.data.length || 0,
      totalHackathons: this.cachedHackathons.length,
      lastError: this.lastError,
    };
  }

  public getCachedEnvelope(): QuackathonAnnouncementEnvelope | null {
    return this.cachedEnvelope;
  }

  public getCachedHackathons(): ClassifiedHackathon[] {
    return this.cachedHackathons;
  }

  /**
   * Run sync immediately (can be called via API or Cron)
   */
  async syncNow(options: ScraperOptions = {}): Promise<{
    success: boolean;
    announcementsCount: number;
    hackathonsCount: number;
    error?: string;
  }> {
    if (this.isSyncing) {
      return {
        success: false,
        announcementsCount: this.cachedEnvelope?.data.length || 0,
        hackathonsCount: this.cachedHackathons.length,
        error: 'Sync already in progress',
      };
    }

    this.isSyncing = true;
    this.lastError = null;

    try {
      console.log(`[CronScheduler] Starting sync at ${new Date().toISOString()}...`);
      const { envelope, hackathons } = await this.scraper.getEventsPipeline(options);

      // Cache Protection: Do not overwrite healthy cache if a run unexpectedly yields 0 items
      if (envelope.data.length === 0 && this.cachedEnvelope && this.cachedEnvelope.data.length > 0) {
        console.warn(
          '[CronScheduler] Warning: Sync yielded 0 announcements while prior cache has data. Preserving previous good cache.'
        );
        this.isSyncing = false;
        this.lastError = 'Sync returned 0 items; previous healthy cache was preserved.';
        return {
          success: false,
          announcementsCount: this.cachedEnvelope.data.length,
          hackathonsCount: this.cachedHackathons.length,
          error: this.lastError,
        };
      }

      this.cachedEnvelope = envelope;
      this.cachedHackathons = hackathons;
      this.lastSyncAt = new Date().toISOString();
      this.isSyncing = false;

      console.log(
        `[CronScheduler] Sync complete! Parsed ${envelope.data.length} announcements, found ${hackathons.length} hackathons.`
      );

      return {
        success: true,
        announcementsCount: envelope.data.length,
        hackathonsCount: hackathons.length,
      };
    } catch (err: any) {
      this.isSyncing = false;
      this.lastError = err.message || String(err);
      console.error('[CronScheduler] Sync error:', err);

      return {
        success: false,
        announcementsCount: this.cachedEnvelope?.data.length || 0,
        hackathonsCount: this.cachedHackathons.length,
        error: this.lastError || undefined,
      };
    }
  }

  /**
   * Start recurring background sync (default: every 30 minutes)
   */
  startCron(cronSchedule = '*/30 * * * *') {
    if (this.cronJob) {
      this.cronJob.stop();
    }

    console.log(`[CronScheduler] Scheduling cron job with pattern: "${cronSchedule}"`);
    this.cronJob = cron.schedule(cronSchedule, async () => {
      console.log('[CronScheduler] Scheduled trigger fired!');
      await this.syncNow();
    });
  }

  stopCron() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }
}
