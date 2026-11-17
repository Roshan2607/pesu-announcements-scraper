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

  // --- TEST SUITE 1: Scraper Extraction & Deterministic Stable IDs ---
  console.log('\n--- 1. Testing Scraper Extraction & Deterministic IDs ---');
  const scraper = new AnnouncementScraper();
  const envelope = await scraper.fetchEnvelope({
    htmlFixture: samplePesuAnnouncementsHtml,
    enableOcr: false,
  });

  assert(envelope.resource === 'announcements', 'Envelope resource matches "announcements"');
  assert(Boolean(envelope.fetched_at), 'Envelope has valid ISO fetched_at timestamp');
  assert(envelope.data.length === 5, `Extracted 5 announcements (got ${envelope.data.length})`);

  const firstAnn = envelope.data[0];
  assert(firstAnn.title.includes('HackerSpace HackFest 2026'), 'Extracted HackFest title correctly');
  assert(firstAnn.date === '14-November-2026', 'Extracted publication date accurately');
  assert(Boolean(firstAnn.image), 'Extracted poster image URL');

  // Assert deterministic ID stability: re-running should generate identical ID
  const recomputedId = scraper.generateStableId(firstAnn.title, firstAnn.date);
  assert(firstAnn.id === recomputedId, `ID is deterministic and stable: ${firstAnn.id}`);

  const envelope2 = await scraper.fetchEnvelope({
    htmlFixture: samplePesuAnnouncementsHtml,
    enableOcr: false,
  });
  assert(envelope2.data[0].id === firstAnn.id, 'IDs are identical across repeated scraper runs');

  // --- TEST SUITE 2: Strict Classifier & No Fabricated Constraints ---
  console.log('\n--- 2. Testing Strict Classifier & Constraint Integrity ---');
  const { allClassified, hackathons } = await scraper.getEventsPipeline({
    htmlFixture: samplePesuAnnouncementsHtml,
    enableOcr: false,
  });

  assert(allClassified.length === 5, 'Classified all 5 announcements');
  assert(
    hackathons.length === 3,
    `Identified exactly 3 competitions (HackFest, Ideathon, CTF) - got ${hackathons.length}`
  );

  // Check HackFest (Explicit team size 2-4)
  const hackfest = hackathons.find((h) => h.title.includes('HackFest'));
  assert(Boolean(hackfest), 'Found HackFest in hackathons list');
  if (hackfest) {
    assert(hackfest.category === 'HACKATHON', 'HackFest categorized as HACKATHON');
    assert(hackfest.organizer === 'HackerSpace PESU' || hackfest.organizer === 'HackerSpace', `Organizer identified as HackerSpace`);
    assert(hackfest.registrationUrl === 'https://hackerspace-pesu.devfolio.co', `Extracted Devfolio URL`);
    assert(hackfest.format === 'onsite', `Format identified as onsite`);
    assert(hackfest.venue === 'RR Campus', `Venue identified as RR Campus`);
    assert(
      hackfest.teamSize?.min === 2 && hackfest.teamSize?.max === 4,
      `Explicit team size 2-4 preserved`
    );
    assert(hackfest.cashPrize?.includes('1,00,000') || false, `Cash prize extracted: ${hackfest.cashPrize}`);
  }

  // Check CTF (No team size specified in announcement -> MUST BE NULL, NEVER DEFAULTED)
  const ctf = hackathons.find((h) => h.category === 'CTF');
  assert(Boolean(ctf), 'Found CTF competition');
  if (ctf) {
    assert(
      ctf.teamSize === null,
      'CTF with unstated team size has teamSize: null (VERIFIED: Never fabricated)'
    );
    assert(
      ctf.venue === null,
      'CTF with unstated venue has venue: null (VERIFIED: Never fabricated)'
    );
  }

  // Check Non-Hackathon that contains word "hack" ("How Systems Get Hacked" talk)
  const guestTalk = allClassified.find((a) => a.title.includes('Get Hacked'));
  assert(
    Boolean(guestTalk && !guestTalk.isHackathon),
    'Guest talk on "How Systems Get Hacked" is NOT classified as a hackathon (Strict word boundary check passed)'
  );

  // Check Routine Exam Circular
  const examNotice = allClassified.find((a) => a.title.includes('Examination'));
  assert(
    Boolean(examNotice && !examNotice.isHackathon),
    'Routine exam circular filtered out from hackathons'
  );

  // --- TEST SUITE 3: Tesseract OCR Engine ---
  console.log('\n--- 3. Testing Tesseract OCR Engine ---');
  try {
    const sampleImage =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const ocrResult = await ocrService.extractText(sampleImage);
    assert(typeof ocrResult === 'string', 'Tesseract OCR worker runs and returns string');
  } catch (err) {
    console.warn('OCR test notice:', err);
  } finally {
    await ocrService.terminate();
  }

  // --- TEST SUITE 4: Express API Endpoints & Auth Middleware ---
  console.log('\n--- 4. Testing API Endpoints & Bearer Token Security ---');
  const testSecretKey = 'test-quackathon-secret-token-777';
  process.env.API_SECRET_KEY = testSecretKey;

  const scheduler = new CronScheduler(scraper);
  const app = express();
  app.use(express.json());
  app.use(createApiRouter(scheduler));

  const testPort = 4199;
  const server = app.listen(testPort);

  try {
    await scheduler.syncNow({ htmlFixture: samplePesuAnnouncementsHtml, enableOcr: false });

    // 4.1 /health is public
    const healthResp = await fetch(`http://localhost:${testPort}/health`);
    assert(healthResp.status === 200, 'GET /health is public and returns 200 OK');

    // 4.2 /api/v1/announcements WITHOUT auth header returns 401 Unauthorized
    const unauthResp = await fetch(`http://localhost:${testPort}/api/v1/announcements`);
    assert(
      unauthResp.status === 401,
      'GET /api/v1/announcements without Bearer token is rejected with 401 Unauthorized'
    );

    // 4.3 /api/v1/announcements WITH invalid Bearer token returns 401
    const invalidAuthResp = await fetch(`http://localhost:${testPort}/api/v1/announcements`, {
      headers: { Authorization: 'Bearer wrong-key' },
    });
    assert(
      invalidAuthResp.status === 401,
      'GET /api/v1/announcements with invalid Bearer token is rejected with 401'
    );

    // 4.4 /api/v1/announcements WITH valid Bearer token returns 200 OK
    const authAnnResp = await fetch(`http://localhost:${testPort}/api/v1/announcements`, {
      headers: { Authorization: `Bearer ${testSecretKey}` },
    });
    assert(authAnnResp.status === 200, 'GET /api/v1/announcements with valid Bearer token returns 200 OK');
    const annJson = await authAnnResp.json();
    assert(annJson.resource === 'announcements', 'Matches Quackathon resource envelope');
    assert(annJson.data.length === 5, 'Returns 5 announcement items');

    // 4.5 /api/v1/hackathons WITH valid Bearer token returns 200 OK
    const hackResp = await fetch(`http://localhost:${testPort}/api/v1/hackathons`, {
      headers: { Authorization: `Bearer ${testSecretKey}` },
    });
    assert(hackResp.status === 200, 'GET /api/v1/hackathons returns 200 OK');
    const hackJson = await hackResp.json();
    assert(hackJson.total === 3, 'Returns exactly 3 verified hackathons');

    // 4.6 Single Hackathon Detail
    const targetId = hackJson.hackathons[0].id;
    const detailResp = await fetch(`http://localhost:${testPort}/api/v1/hackathons/${targetId}`, {
      headers: { Authorization: `Bearer ${testSecretKey}` },
    });
    assert(detailResp.status === 200, 'GET /api/v1/hackathons/:id returns 200 OK');

    // 4.7 POST /api/v1/sync requires Bearer token
    const unauthSyncResp = await fetch(`http://localhost:${testPort}/api/v1/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ htmlFixture: samplePesuAnnouncementsHtml }),
    });
    assert(unauthSyncResp.status === 401, 'POST /api/v1/sync without Bearer token returns 401');

    const authSyncResp = await fetch(`http://localhost:${testPort}/api/v1/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testSecretKey}`,
      },
      body: JSON.stringify({ htmlFixture: samplePesuAnnouncementsHtml }),
    });
    assert(authSyncResp.status === 200, 'POST /api/v1/sync with Bearer token returns 200 OK');

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
