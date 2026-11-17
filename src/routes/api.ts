import { Router } from 'express';
import { CronScheduler } from '../services/cronScheduler.js';

export function createApiRouter(scheduler: CronScheduler): Router {
  const router = Router();

  // 1. Health & Status
  router.get('/health', (req, res) => {
    res.json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      sync: scheduler.getStatus(),
    });
  });

  // 2. Raw Envelope for Quackathon's normalizePesuAnnouncementPayload()
  router.get('/api/v1/announcements', async (req, res) => {
    let envelope = scheduler.getCachedEnvelope();

    // Auto-sync on first request if cache is empty
    if (!envelope) {
      const syncResult = await scheduler.syncNow();
      if (!syncResult.success && !scheduler.getCachedEnvelope()) {
        res.status(502).json({
          ok: false,
          error: syncResult.error || 'Failed to fetch announcements from PESU Academy',
        });
        return;
      }
      envelope = scheduler.getCachedEnvelope();
    }

    res.json(envelope);
  });

  // 3. Filtered & Classified Hackathons
  router.get('/api/v1/hackathons', async (req, res) => {
    let hackathons = scheduler.getCachedHackathons();

    if (hackathons.length === 0 && !scheduler.getStatus().lastSyncAt) {
      await scheduler.syncNow();
      hackathons = scheduler.getCachedHackathons();
    }

    const { category, format, min_prize } = req.query;

    let filtered = hackathons;
    if (category) {
      filtered = filtered.filter(
        (h) => h.category.toLowerCase() === String(category).toLowerCase()
      );
    }
    if (format) {
      filtered = filtered.filter(
        (h) => h.format.toLowerCase() === String(format).toLowerCase()
      );
    }

    res.json({
      ok: true,
      total: filtered.length,
      synced_at: scheduler.getStatus().lastSyncAt,
      hackathons: filtered,
    });
  });

  // 4. Single Hackathon Details
  router.get('/api/v1/hackathons/:id', (req, res) => {
    const hackathons = scheduler.getCachedHackathons();
    const found = hackathons.find((h) => h.id === req.params.id);

    if (!found) {
      res.status(404).json({
        ok: false,
        error: `Hackathon with id '${req.params.id}' not found`,
      });
      return;
    }

    res.json({
      ok: true,
      hackathon: found,
    });
  });

  // 5. Trigger Immediate Sync (Cron hook or Manual Webhook)
  router.post('/api/v1/sync', async (req, res) => {
    const enableOcr = req.query.ocr !== 'false';
    const htmlFixture = req.body?.htmlFixture;

    console.log('[API] Manual sync triggered via POST /api/v1/sync');
    const result = await scheduler.syncNow({
      enableOcr,
      htmlFixture,
    });

    if (result.success) {
      res.json({
        ok: true,
        message: 'Sync completed successfully',
        announcementsCount: result.announcementsCount,
        hackathonsCount: result.hackathonsCount,
        synced_at: scheduler.getStatus().lastSyncAt,
      });
    } else {
      res.status(500).json({
        ok: false,
        error: result.error,
        message: 'Sync failed',
      });
    }
  });

  return router;
}
