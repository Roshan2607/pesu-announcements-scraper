process.env.NODE_ENV = 'test';

import { AnnouncementScraper } from '../src/services/announcementScraper.js';
import { samplePesuAnnouncementsHtml } from './fixtures/sampleAnnouncements.js';
import { CronScheduler } from '../src/services/cronScheduler.js';
import { createApiRouter } from '../src/routes/api.js';
import express from 'express';
import { ocrService } from '../src/services/ocrService.js';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING HARDENED PESU SCRAPER VERIFICATION');
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

  // --- TEST SUITE 1: Collision-Resistant Deterministic IDs ---
  console.log('\n--- 1. Testing Collision-Resistant Deterministic IDs ---');
  const scraper = new AnnouncementScraper();
  const envelope = await scraper.fetchEnvelope({
    htmlFixture: samplePesuAnnouncementsHtml,
    enableOcr: false,
  });

  assert(envelope.resource === 'announcements', 'Envelope resource matches "announcements"');
  assert(envelope.data.length === 5, `Extracted 5 announcements (got ${envelope.data.length})`);

  const firstAnn = envelope.data[0];
  const recomputedId = scraper.generateStableId(firstAnn.title, firstAnn.date, firstAnn.description);
  assert(firstAnn.id === recomputedId, `ID is deterministic: ${firstAnn.id}`);

  // Test collision resistance: Two announcements with identical titles and dates but different descriptions
  const idA = scraper.generateStableId('ISA-2 Timetable', '17-November-2026', 'For CSE Department Section A');
  const idB = scraper.generateStableId('ISA-2 Timetable', '17-November-2026', 'For BBA Analytics Department');
  assert(idA !== idB, 'Different announcements with same title & date produce distinct IDs (No collisions)');

  // --- TEST SUITE 2: Strict Classifier, ISO Dates & Constraint Integrity ---
  console.log('\n--- 2. Testing Strict Classifier & Validated ISO Dates ---');
  const { allClassified, hackathons } = await scraper.getEventsPipeline({
    htmlFixture: samplePesuAnnouncementsHtml,
    enableOcr: false,
  });

  assert(allClassified.length === 5, 'Classified all 5 announcements');
  assert(
    hackathons.length === 3,
    `Identified exactly 3 competitions (HackFest, Ideathon, CTF) - got ${hackathons.length}`
  );

  // Check HackFest (Explicit team size 2-4 and ISO date range)
  const hackfest = hackathons.find((h) => h.title.includes('HackFest'));
  assert(Boolean(hackfest), 'Found HackFest in hackathons list');
  if (hackfest) {
    assert(hackfest.category === 'HACKATHON', 'HackFest categorized as HACKATHON');
    assert(
      hackfest.eventDates.start === '2026-11-28' && hackfest.eventDates.end === '2026-11-29',
      `Validated ISO dates extracted: ${hackfest.eventDates.start} to ${hackfest.eventDates.end}`
    );
    assert(
      hackfest.teamSize?.min === 2 && hackfest.teamSize?.max === 4,
      `Explicit team size range 2-4 preserved`
    );
  }

  // Check Ideathon (Single ISO date parsing)
  const ideathon = hackathons.find((h) => h.title.includes('Ideathon'));
  assert(Boolean(ideathon), 'Found Ideathon in hackathons list');
  if (ideathon) {
    assert(
      ideathon.eventDates.start === '2026-12-05' && ideathon.eventDates.end === '2026-12-05',
      `Single date parsed to ISO: ${ideathon.eventDates.start}`
    );
    assert(
      ideathon.teamSize?.min === 2 && ideathon.teamSize?.max === 3,
      `Explicit team size 2-3 preserved`
    );
  }

  // Check CTF (No team size specified -> MUST BE NULL, NEVER FABRICATED)
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
    'Guest talk on "How Systems Get Hacked" is NOT classified as a hackathon'
  );

  // --- TEST SUITE 3: OCR SSRF Protection & Domain Whitelist ---
  console.log('\n--- 3. Testing OCR Security & Domain Whitelist ---');
  assert(
    ocrService.isUrlAllowed('https://www.pesuacademy.com/poster.jpg'),
    'Allows official www.pesuacademy.com domain'
  );
  assert(
    ocrService.isUrlAllowed('https://files.pesuacademy.com/flyer.png'),
    'Allows files.pesuacademy.com domain'
  );
  assert(
    !ocrService.isUrlAllowed('http://169.254.169.254/latest/meta-data'),
    'Blocks AWS metadata IP (SSRF prevention)'
  );
  assert(
    !ocrService.isUrlAllowed('http://localhost:8080/internal'),
    'Blocks local HTTP loopback URLs'
  );
  assert(
    !ocrService.isUrlAllowed('https://evil-unapproved-site.com/image.png'),
    'Blocks untrusted third-party domains'
  );

  // --- TEST SUITE 4: Security Middleware & Fail-Closed Behavior ---
  console.log('\n--- 4. Testing Fail-Closed Auth & Endpoints ---');

  // Test 4.1: Fail-closed when API_SECRET_KEY is empty
  delete process.env.API_SECRET_KEY;
  delete process.env.SCRAPER_API_KEY;

  const failClosedScheduler = new CronScheduler(scraper);
  const failClosedApp = express();
  failClosedApp.use(express.json());
  failClosedApp.use(createApiRouter(failClosedScheduler));

  const fcPort = 4291;
  const fcServer = failClosedApp.listen(fcPort);
  try {
    const fcResp = await fetch(`http://localhost:${fcPort}/api/v1/hackathons`);
    assert(
      fcResp.status === 500,
      'Fails closed with 500 Server Misconfiguration when API_SECRET_KEY is unset'
    );
  } finally {
    fcServer.close();
  }

  // Test 4.2: Authenticated server with secret key
  const testSecretKey = 'super-secret-quackathon-key-2026';
  process.env.API_SECRET_KEY = testSecretKey;

  const authScheduler = new CronScheduler(scraper);
  const authApp = express();
  authApp.use(express.json());
  authApp.use(createApiRouter(authScheduler));

  const authPort = 4292;
  const authServer = authApp.listen(authPort);

  try {
    await authScheduler.syncNow({ htmlFixture: samplePesuAnnouncementsHtml, enableOcr: false });

    // Public /health works
    const healthResp = await fetch(`http://localhost:${authPort}/health`);
    assert(healthResp.status === 200, 'GET /health is public and returns 200 OK');

    // Missing token is rejected with 401
    const unauthResp = await fetch(`http://localhost:${authPort}/api/v1/hackathons`);
    assert(unauthResp.status === 401, 'Request without Bearer token returns 401');

    // Invalid token is rejected with 401
    const badTokenResp = await fetch(`http://localhost:${authPort}/api/v1/hackathons`, {
      headers: { Authorization: 'Bearer wrong-key' },
    });
    assert(badTokenResp.status === 401, 'Request with invalid token returns 401');

    // Valid Bearer token returns 200 OK
    const goodResp = await fetch(`http://localhost:${authPort}/api/v1/hackathons`, {
      headers: { Authorization: `Bearer ${testSecretKey}` },
    });
    assert(goodResp.status === 200, 'Request with valid Bearer token returns 200 OK');
    const goodJson = await goodResp.json();
    assert(goodJson.total === 3, 'Returns 3 verified hackathons');

    // Quackathon dedicated endpoint returns normalized envelope of hackathons
    const qResp = await fetch(`http://localhost:${authPort}/api/v1/quackathon/events`, {
      headers: { Authorization: `Bearer ${testSecretKey}` },
    });
    assert(qResp.status === 200, 'GET /api/v1/quackathon/events returns 200 OK');
    const qJson = await qResp.json();
    assert(qJson.resource === 'announcements', 'Resource is "announcements"');
    assert(qJson.data.length === 3, 'Quackathon events endpoint contains only verified hackathons');

    // Test 4.3: Cache protection (Zero-item sync does not overwrite healthy cache)
    console.log('\n--- 5. Testing Cache Protection ---');
    // Simulate an unexpected malformed page yielding 0 items
    const emptySyncResult = await authScheduler.syncNow({
      htmlFixture: '<html><body><div>No announcements here</div></body></html>',
      enableOcr: false,
    });
    assert(
      emptySyncResult.success === false,
      'Sync returning 0 items reports success: false'
    );
    assert(
      authScheduler.getCachedHackathons().length === 3,
      'Healthy cache preserved (not overwritten with 0 items)'
    );

  } finally {
    authServer.close();
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
