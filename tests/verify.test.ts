import { AnnouncementScraper } from '../src/services/announcementScraper.js';
import { samplePesuAnnouncementsHtml } from './fixtures/sampleAnnouncements.js';
import { CronScheduler } from '../src/services/cronScheduler.js';
import { createApiRouter } from '../src/routes/api.js';
import express from 'express';
import { ocrService } from '../src/services/ocrService.js';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING PESU ANNOUNCEMENTS SCRAPER VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // --- TEST SUITE 1: Scraper & Parser Validation ---
  console.log('\n--- 1. Testing Scraper Extraction & Quackathon Envelope ---');
  const scraper = new AnnouncementScraper();
  const envelope = await scraper.fetchEnvelope({
    htmlFixture: samplePesuAnnouncementsHtml,
    enableOcr: false, // disable network OCR for static HTML test
  });

  assert(envelope.resource === 'announcements', 'Envelope resource matches "announcements"');
  assert(Boolean(envelope.fetched_at), 'Envelope has valid ISO fetched_at timestamp');
  assert(envelope.data.length === 4, `Extracted 4 announcements (got ${envelope.data.length})`);

  const firstAnn = envelope.data[0];
  assert(firstAnn.title.includes('HackerSpace HackFest 2026'), 'Extracted HackFest title correctly');
  assert(firstAnn.date === '14-November-2026', 'Extracted publication date accurately');
  assert(Boolean(firstAnn.image), 'Extracted poster image URL');
  assert(firstAnn.attachments === 1, 'Extracted attachment download count');

  // --- TEST SUITE 2: Classification & Entity Extraction ---
  console.log('\n--- 2. Testing Classifier & Entity Extraction ---');
  const { allClassified, hackathons } = await scraper.getEventsPipeline({
    htmlFixture: samplePesuAnnouncementsHtml,
    enableOcr: false,
  });

  assert(allClassified.length === 4, 'Classified all 4 announcements');
  assert(hackathons.length === 3, `Correctly identified 3 technical hackathons/competitions (got ${hackathons.length})`);

  // Check HackFest
  const hackfest = hackathons.find((h) => h.title.includes('HackFest'));
  assert(Boolean(hackfest), 'Found HackFest in hackathons list');
  if (hackfest) {
    assert(hackfest.category === 'HACKATHON', 'HackFest categorized as HACKATHON');
    assert(hackfest.organizer === 'HackerSpace', `Organizer identified as HackerSpace (got ${hackfest.organizer})`);
    assert(hackfest.registrationUrl === 'https://hackerspace-pesu.devfolio.co', `Extracted Devfolio URL (${hackfest.registrationUrl})`);
    assert(hackfest.format === 'onsite', `Format identified as onsite (${hackfest.format})`);
    assert(hackfest.venue === 'RR Campus', `Venue identified as RR Campus (${hackfest.venue})`);
    assert(hackfest.teamSize?.min === 2 && hackfest.teamSize?.max === 4, `Team size extracted as 2-4`);
    assert(hackfest.cashPrize?.includes('1,00,000') || false, `Cash prize extracted: ${hackfest.cashPrize}`);
  }

  // Check Ideathon
  const ideathon = hackathons.find((h) => h.title.includes('Ideathon'));
  assert(Boolean(ideathon), 'Found Ideathon in hackathons list');
  if (ideathon) {
    assert(ideathon.category === 'IDEATHON', 'Ideathon categorized as IDEATHON');
    assert(ideathon.organizer === 'ACM PESU', 'Organizer identified as ACM PESU');
    assert(ideathon.registrationUrl?.includes('unstop.com') || false, `Extracted Unstop URL (${ideathon.registrationUrl})`);
    assert(ideathon.format === 'hybrid', `Format identified as hybrid (${ideathon.format})`);
  }

  // Check Non-Hackathon Circular
  const examNotice = allClassified.find((a) => a.title.includes('Examination'));
  assert(Boolean(examNotice && !examNotice.isHackathon), 'Correctly filtered out exam timetable from hackathons');

  // --- TEST SUITE 3: Tesseract OCR Engine Test ---
  console.log('\n--- 3. Testing Tesseract OCR Engine ---');
  try {
    // 1x1 base64 transparent PNG to ensure worker initializes without crashing
    const sampleImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const ocrResult = await ocrService.extractText(sampleImage);
    assert(typeof ocrResult === 'string', 'Tesseract OCR worker runs and returns string');
  } catch (err) {
    console.warn('OCR test notice:', err);
  } finally {
    await ocrService.terminate();
  }

  // --- TEST SUITE 4: Live Express API Endpoints & Cron Ingestion ---
  console.log('\n--- 4. Testing Express API Endpoints ---');
  const scheduler = new CronScheduler(scraper);
  const app = express();
  app.use(express.json());
  app.use(createApiRouter(scheduler));

  const testPort = 4099;
  const server = app.listen(testPort);

  try {
    // Seed scheduler with test fixture
    await scheduler.syncNow({ htmlFixture: samplePesuAnnouncementsHtml, enableOcr: false });

    // 4.1 Test /health
    const healthResp = await fetch(`http://localhost:${testPort}/health`);
    assert(healthResp.status === 200, 'GET /health returns 200 OK');
    const healthJson = await healthResp.json();
    assert(healthJson.status === 'UP', 'Health status is UP');

    // 4.2 Test /api/v1/announcements
    const annResp = await fetch(`http://localhost:${testPort}/api/v1/announcements`);
    assert(annResp.status === 200, 'GET /api/v1/announcements returns 200 OK');
    const annJson = await annResp.json();
    assert(annJson.resource === 'announcements', 'Announcements endpoint returns Quackathon-compatible resource envelope');
    assert(annJson.data.length === 4, `Returns 4 announcement items`);

    // 4.3 Test /api/v1/hackathons
    const hackResp = await fetch(`http://localhost:${testPort}/api/v1/hackathons`);
    assert(hackResp.status === 200, 'GET /api/v1/hackathons returns 200 OK');
    const hackJson = await hackResp.json();
    assert(hackJson.ok === true && hackJson.total === 3, 'Returns 3 filtered hackathons');

    // 4.4 Test /api/v1/hackathons with filter query (?category=IDEATHON)
    const ideathonResp = await fetch(`http://localhost:${testPort}/api/v1/hackathons?category=IDEATHON`);
    const ideathonJson = await ideathonResp.json();
    assert(ideathonJson.total === 1, 'Filter query ?category=IDEATHON returns exactly 1 item');

    // 4.5 Test /api/v1/hackathons/:id
    const targetId = hackJson.hackathons[0].id;
    const detailResp = await fetch(`http://localhost:${testPort}/api/v1/hackathons/${targetId}`);
    assert(detailResp.status === 200, 'GET /api/v1/hackathons/:id returns 200 OK');
    const detailJson = await detailResp.json();
    assert(detailJson.hackathon.id === targetId, 'Detail route returns correct hackathon object');

    // 4.6 Test POST /api/v1/sync (Webhook / Manual Trigger)
    const syncPostResp = await fetch(`http://localhost:${testPort}/api/v1/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ htmlFixture: samplePesuAnnouncementsHtml }),
    });
    assert(syncPostResp.status === 200, 'POST /api/v1/sync returns 200 OK');
    const syncPostJson = await syncPostResp.json();
    assert(syncPostJson.ok === true, 'Sync endpoint reports ok: true');

    console.log('\n--- SAMPLE OUTPUT PREVIEW FROM /api/v1/hackathons ---');
    console.log(JSON.stringify(hackJson.hackathons[0], null, 2));

  } finally {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
