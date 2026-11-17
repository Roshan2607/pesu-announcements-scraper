import { Router } from 'express';
import { CronScheduler } from '../services/cronScheduler.js';
import { requireApiAuth } from '../middleware/auth.js';

export function createApiRouter(scheduler: CronScheduler): Router {
  const router = Router();

  // 1. Health & Status (Public diagnostic endpoint)
  router.get('/health', (req, res) => {
    res.json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      sync: scheduler.getStatus(),
    });
  });

  // Apply authentication middleware to all data and trigger endpoints
  router.use('/api', requireApiAuth);

  // 2. Safe Hackathons & Competitions Endpoint (Primary for Quackathon matching)
  // Exposes ONLY verified, non-personal hackathon & competition metadata
  router.get('/api/v1/hackathons', async (req, res) => {
    let hackathons = scheduler.getCachedHackathons();

    if (hackathons.length === 0 && !scheduler.getStatus().lastSyncAt) {
      await scheduler.syncNow();
      hackathons = scheduler.getCachedHackathons();
    }

    const { category, format } = req.query;

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

  // 3. Single Hackathon Details
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

  // 4. Quackathon Normalized Envelope (Restricted to Hackathons & Competitions only)
  router.get('/api/v1/quackathon/events', async (req, res) => {
    let hackathons = scheduler.getCachedHackathons();

    if (hackathons.length === 0 && !scheduler.getStatus().lastSyncAt) {
      await scheduler.syncNow();
      hackathons = scheduler.getCachedHackathons();
    }

    // Convert classified hackathons into Quackathon's envelope format
    const quackathonData = hackathons.map((h) => ({
      id: h.id,
      title: h.title,
      date: h.publishedDate || '',
      description: h.description,
      image: h.posterUrl,
      attachments: 0,
      ocrText: h.ocrSnippet || null,
    }));

    res.json({
      resource: 'announcements',
      fetched_at: scheduler.getStatus().lastSyncAt || new Date().toISOString(),
      data: quackathonData,
    });
  });

  // 5. Raw Announcement Feed (Restricted: requires EXPOSE_RAW_ANNOUNCEMENTS=true)
  router.get('/api/v1/announcements', async (req, res) => {
    // Architectural protection: Raw student circulars shouldn't be exposed by default
    if (process.env.EXPOSE_RAW_ANNOUNCEMENTS !== 'true' && process.env.NODE_ENV !== 'test') {
      res.status(403).json({
        ok: false,
        error:
          'Access to raw announcement feed is restricted. Use /api/v1/hackathons or /api/v1/quackathon/events for non-personal event metadata.',
      });
      return;
    }

    let envelope = scheduler.getCachedEnvelope();

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

  // 6. Trigger Immediate Sync (Cron hook or Manual Webhook)
  router.post('/api/v1/sync', async (req, res) => {
    const enableOcr = req.query.ocr !== 'false';

    // Security: Only accept custom htmlFixture when explicitly in test environment
    if (req.body?.htmlFixture && process.env.NODE_ENV !== 'test') {
      res.status(403).json({
        ok: false,
        error: 'Forbidden: Custom htmlFixture injection is restricted to test environments only.',
      });
      return;
    }

    const htmlFixture = process.env.NODE_ENV === 'test' ? req.body?.htmlFixture : undefined;

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
