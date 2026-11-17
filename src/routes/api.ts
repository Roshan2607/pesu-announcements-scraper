import { Router } from 'express';
import { CronScheduler } from '../services/cronScheduler.js';
import { requireApiAuth } from '../middleware/auth.js';
import { PesuAuthSession } from '../services/pesuAuthSession.js';

export function createApiRouter(scheduler: CronScheduler): Router {
  const router = Router();

  // 1. Health & Status (Public diagnostic endpoint)
  router.get('/health', (req, res) => {
    res.json({
      service: 'PAASHA',
      name: 'PESU Academy Announcements Scraper & Hackathon API',
      status: 'UP',
      timestamp: new Date().toISOString(),
      sync: scheduler.getStatus(),
    });
  });

  // Apply authentication middleware to all data and trigger endpoints
  router.use('/api', requireApiAuth);

  // 2. Live Connection Verification Endpoint
  // Performs a direct health ping against PESU Academy to confirm live connection status
  router.get('/api/v1/connection-status', async (req, res) => {
    const srn = process.env.PESU_SRN;
    const pwd = process.env.PESU_PASSWORD;

    if (!srn || !pwd || srn === 'PES1UG22CS000') {
      res.status(503).json({
        ok: false,
        portalLive: false,
        message: 'PESU Academy credentials not configured in environment secrets.',
      });
      return;
    }

    const testSession = new PesuAuthSession(srn, pwd);
    const start = Date.now();
    const loginResult = await testSession.login();
    const latencyMs = Date.now() - start;

    if (loginResult.success) {
      res.json({
        ok: true,
        portalLive: true,
        sessionActive: true,
        latencyMs,
        checkedAt: new Date().toISOString(),
        syncStatus: scheduler.getStatus(),
      });
    } else {
      res.status(502).json({
        ok: false,
        portalLive: false,
        sessionActive: false,
        latencyMs,
        error: 'Failed to establish active session with PESU Academy.',
      });
    }
  });

  // 3. Safe Hackathons & Competitions Endpoint (Primary for Quackathon matching)
  // Exposes ONLY verified, non-personal hackathon & competition metadata
  router.get('/api/v1/hackathons', async (req, res) => {
    let hackathons = scheduler.getCachedHackathons();

    if (hackathons.length === 0 && !scheduler.getStatus().lastSyncAt) {
      await scheduler.syncNow();
      hackathons = scheduler.getCachedHackathons();
    }

    const { category, format, matchable_only, include_unverified } = req.query;

    let filtered = hackathons;

    // Independent Source Verification Filter:
    // By default, only expose independently verified events unless explicitly requesting unverified review items
    if (include_unverified !== 'true') {
      filtered = filtered.filter((h) => h.verification.isIndependentlyVerified);
    }

    if (matchable_only === 'true') {
      filtered = filtered.filter((h) => h.isMatchable);
    }

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

    // Apply the same independent verification protection as listing endpoint
    const { include_unverified } = req.query;
    if (include_unverified !== 'true' && !found.verification.isIndependentlyVerified) {
      res.status(404).json({
        ok: false,
        error: `Hackathon with id '${req.params.id}' not found or pending independent verification`,
      });
      return;
    }

    res.json({
      ok: true,
      hackathon: found,
    });
  });

  // 5. Quackathon Normalized Envelope (Restricted to verified matchable hackathons only)
  router.get('/api/v1/quackathon/events', async (req, res) => {
    let hackathons = scheduler.getCachedHackathons();

    if (hackathons.length === 0 && !scheduler.getStatus().lastSyncAt) {
      await scheduler.syncNow();
      hackathons = scheduler.getCachedHackathons();
    }

    // Filter to independently verified hackathons for safe public team matching
    const verifiedHackathons = hackathons.filter(
      (h) => h.verification.isIndependentlyVerified && h.isMatchable
    );

    const quackathonData = verifiedHackathons.map((h) => ({
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

  // 6. Raw Announcement Feed (Restricted: requires EXPOSE_RAW_ANNOUNCEMENTS=true)
  router.get('/api/v1/announcements', async (req, res) => {
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

  // 7. Trigger Immediate Sync (Cron hook or Manual Webhook)
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
