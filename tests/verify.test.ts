process.env.NODE_ENV = 'test';

import { AnnouncementScraper } from '../src/services/announcementScraper.js';
import { samplePesuAnnouncementsHtml } from './fixtures/sampleAnnouncements.js';
import { CronScheduler } from '../src/services/cronScheduler.js';
import { createApiRouter } from '../src/routes/api.js';
import express from 'express';
import { ocrService } from '../src/services/ocrService.js';
import {
  classifyAnnouncement,
  extractEligibility,
  isValidCalendarDate,
  parseIsoDateRange,
} from '../src/services/classifier.js';
import { FetchFunction, SourceVerifier } from '../src/services/sourceVerifier.js';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING HARDENED PAASHA VERIFICATION');
  console.log('   (PESU Academy Announcements Scraper & Hackathon API)');
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

  // --- TEST SUITE 2: Strict Classifier, Real Calendar Validity & Candidate Extraction ---
  console.log('\n--- 2. Testing Strict Classifier, Real Calendar Validity & Candidates ---');

  // Test 2.1: Real Calendar Validity
  assert(isValidCalendarDate(2026, 11, 28) === true, 'Valid calendar date accepted (2026-11-28)');
  assert(isValidCalendarDate(2026, 11, 31) === false, 'Invalid calendar date rejected (November 31 does not exist)');
  assert(isValidCalendarDate(2026, 2, 29) === false, 'Invalid leap day in non-leap year rejected (2026-02-29)');
  assert(isValidCalendarDate(2024, 2, 29) === true, 'Valid leap day in leap year accepted (2024-02-29)');

  const invalidIsoParsed = parseIsoDateRange('2026-02-31');
  assert(invalidIsoParsed.start === null, 'Regex matching 2026-02-31 is rejected due to calendar invalidity');
  const invalidRangeParsed = parseIsoDateRange('31st November 2026');
  assert(invalidRangeParsed.start === null, '31st November is rejected due to calendar invalidity');
  const validRangeParsed = parseIsoDateRange('28th - 29th November 2026');
  assert(
    validRangeParsed.start === '2026-11-28' && validRangeParsed.end === '2026-11-29',
    'Valid date range extracted and validated: 2026-11-28 to 2026-11-29'
  );

  // Test 2.2: Unknown Registration Status Stays UNKNOWN
  const noticeNoDeadline = extractEligibility('Welcome to the contest. Please attend at RR Campus.');
  assert(
    noticeNoDeadline.status === 'UNKNOWN',
    'Unstated registration deadline/status stays UNKNOWN (Never defaulted to REGISTRATION_OPEN)'
  );

  // Test 2.3: Initial Classification (Public URL returned as candidate, NOT immediately verified)
  const rawAnns = await scraper.parseAnnouncementsHtml(samplePesuAnnouncementsHtml);
  const initialClassified = rawAnns.map(classifyAnnouncement);
  const initialHackfest = initialClassified.find((h) => h.title.includes('HackFest'))!;

  assert(
    initialHackfest.verification.isIndependentlyVerified === false,
    'Candidate URL is NOT immediately marked as verified (requires active network check)'
  );
  assert(
    initialHackfest.verification.candidateProofUrl === 'https://hackerspace-pesu.devfolio.co',
    'Candidate proof URL correctly captured for verification'
  );
  assert(
    initialHackfest.verification.publicProofUrl === null,
    'publicProofUrl remains null until actively verified'
  );
  assert(
    initialHackfest.isMatchable === false,
    'isMatchable remains false before independent verification'
  );

  // --- TEST SUITE 3: Active Public-Source Verification Engine ---
  console.log('\n--- 3. Testing Active Public-Source Verification (sourceVerifier) ---');

  // Create a mock fetcher to test active verification scenarios deterministically
  const mockFetch: FetchFunction = async (url: string) => {
    if (url.includes('hackerspace-pesu.devfolio.co')) {
      return new Response(
        `<html><head><title>HackerSpace HackFest 2026</title></head><body><h1>HackerSpace HackFest 2026</h1><p>Join HackFest 24-Hour National Hackathon!</p></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }
    if (url.includes('unstop.com/o/acm-pesu-ideathon')) {
      return new Response(
        `<html><head><title>ACM PESU Ideathon</title></head><body><h1>ACM PESU Ideathon</h1><p>Ideathon for campus sustainability</p></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }
    if (url.includes('forms.gle/ctfpesu2026') || url.includes('docs.google.com/forms')) {
      return new Response(
        `<html><head><title>Capture The Flag CTF 2026</title></head><body><h1>PESU CTF 2026</h1></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }
    if (url.includes('closed-form')) {
      return new Response(
        `<html><head><title>Event Form</title></head><body><div class="freebirdFormviewerViewHeaderTitle">This form is no longer accepting responses</div></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }
    if (url.includes('mismatch-site')) {
      return new Response(
        `<html><head><title>Bakery Online Menu</title></head><body><h1>Delicious Pastries and Cakes</h1></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }
    if (url.includes('dead-link')) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response('Not Found', { status: 404 });
  };

  const testVerifier = new SourceVerifier({ fetchFn: mockFetch });

  // Test 3.1: Successful verification with matching keywords
  const verifiedHackfest = await testVerifier.verifyHackathon(structuredClone(initialHackfest));
  assert(
    verifiedHackfest.verification.isIndependentlyVerified === true,
    'HackFest verified successfully after fetching active page with matching keywords'
  );
  assert(
    verifiedHackfest.verification.publicProofUrl === 'https://hackerspace-pesu.devfolio.co',
    'publicProofUrl assigned upon confirmed verification'
  );
  assert(
    verifiedHackfest.verification.verificationStatus === 'VERIFIED',
    'verificationStatus set to VERIFIED'
  );
  assert(
    verifiedHackfest.isMatchable === true,
    'Confirmed team event (teams 2-4) marked isMatchable = true after verification'
  );

  // Test 3.2: Unknown team size stays isMatchable = false even after verification
  const initialCtf = initialClassified.find((h) => h.category === 'CTF')!;
  assert(initialCtf.teamSize === null, 'CTF has teamSize: null');
  const verifiedCtf = await testVerifier.verifyHackathon(structuredClone(initialCtf));
  assert(
    verifiedCtf.verification.isIndependentlyVerified === true,
    'CTF source verified via active public page'
  );
  assert(
    verifiedCtf.isMatchable === false,
    'Unknown team eligibility means isMatchable = false until team constraints confirmed'
  );

  // Test 3.3: Accessibility Failure (HTTP 404)
  const deadLinkHackathon = structuredClone(initialHackfest);
  deadLinkHackathon.verification.candidateProofUrl = 'https://devfolio.co/dead-link';
  const failedAccessHackathon = await testVerifier.verifyHackathon(deadLinkHackathon);
  assert(
    failedAccessHackathon.verification.isIndependentlyVerified === false,
    '404 link rejected: isIndependentlyVerified remains false'
  );
  assert(
    failedAccessHackathon.verification.verificationStatus === 'FAILED_ACCESSIBILITY',
    'Status set to FAILED_ACCESSIBILITY'
  );
  assert(
    failedAccessHackathon.isMatchable === false,
    'isMatchable is false when source verification fails accessibility'
  );

  // Test 3.4: Relevance Failure (Page does not describe the announcement)
  const mismatchHackathon = structuredClone(initialHackfest);
  mismatchHackathon.verification.candidateProofUrl = 'https://devfolio.co/mismatch-site';
  const failedRelevanceHackathon = await testVerifier.verifyHackathon(mismatchHackathon);
  assert(
    failedRelevanceHackathon.verification.isIndependentlyVerified === false,
    'Irrelevant page rejected: isIndependentlyVerified remains false'
  );
  assert(
    failedRelevanceHackathon.verification.verificationStatus === 'FAILED_RELEVANCE',
    'Status set to FAILED_RELEVANCE'
  );

  // Test 3.5: Closed form detected
  const closedFormHackathon = structuredClone(initialHackfest);
  closedFormHackathon.verification.candidateProofUrl = 'https://forms.gle/closed-form';
  const failedClosedHackathon = await testVerifier.verifyHackathon(closedFormHackathon);
  assert(
    failedClosedHackathon.verification.isIndependentlyVerified === false,
    'Closed registration form rejected from verified active events'
  );

  // --- TEST SUITE 4: OCR Security & Domain Whitelist ---
  console.log('\n--- 4. Testing OCR Security & Domain Whitelist ---');
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

  // --- TEST SUITE 5: API Security & Verification Filter on /api/v1/hackathons/:id ---
  console.log('\n--- 5. Testing Fail-Closed Auth & Endpoints ---');

  // Test 5.1: Fail-closed when API_SECRET_KEY is empty
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

  // Test 5.2: Authenticated server with secret key & verified pipeline
  const testSecretKey = 'super-secret-quackathon-key-2026';
  process.env.API_SECRET_KEY = testSecretKey;

  const authScheduler = new CronScheduler(scraper);
  const authApp = express();
  authApp.use(express.json());
  authApp.use(createApiRouter(authScheduler));

  const authPort = 4292;
  const authServer = authApp.listen(authPort);

  try {
    // Sync using our mock verifier so events are verified deterministically
    await authScheduler.syncNow({
      htmlFixture: samplePesuAnnouncementsHtml,
      enableOcr: false,
      sourceVerifier: testVerifier,
    });

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
    assert(goodJson.total === 3, 'Returns 3 independently verified hackathons');

    // Quackathon dedicated endpoint returns normalized envelope of hackathons
    const qResp = await fetch(`http://localhost:${authPort}/api/v1/quackathon/events`, {
      headers: { Authorization: `Bearer ${testSecretKey}` },
    });
    assert(qResp.status === 200, 'GET /api/v1/quackathon/events returns 200 OK');
    const qJson = await qResp.json();
    assert(qJson.resource === 'announcements', 'Resource is "announcements"');
    // Only team-confirmed verified events are returned in quackathon envelope (HackFest & Ideathon)
    assert(qJson.data.length === 2, 'Quackathon events envelope contains only verified matchable hackathons (got 2)');

    // Filter params test: matchable_only=true returns 2 (HackFest and Ideathon, excludes unconfirmed CTF)
    const matchResp = await fetch(`http://localhost:${authPort}/api/v1/hackathons?matchable_only=true`, {
      headers: { Authorization: `Bearer ${testSecretKey}` },
    });
    assert(matchResp.status === 200, 'GET /api/v1/hackathons?matchable_only=true returns 200 OK');
    const matchJson = await matchResp.json();
    assert(matchJson.total === 2, 'matchable_only=true returns exactly 2 confirmed team hackathons');

    // Test 5.3: Verification filter on GET /api/v1/hackathons/:id
    console.log('\n--- 6. Testing /api/v1/hackathons/:id Verification Gating ---');
    const verifiedItem = goodJson.hackathons[0];

    // Verified hackathon accessible by ID
    const singleVerifiedResp = await fetch(`http://localhost:${authPort}/api/v1/hackathons/${verifiedItem.id}`, {
      headers: { Authorization: `Bearer ${testSecretKey}` },
    });
    assert(singleVerifiedResp.status === 200, 'Verified hackathon is accessible via GET /api/v1/hackathons/:id');

    // Manually inject an unverified hackathon into scheduler cache to test ID access gating
    const unverifiedCandidate = structuredClone(verifiedItem);
    unverifiedCandidate.id = 'pesu_ann_unverified_test_123';
    unverifiedCandidate.verification.isIndependentlyVerified = false;
    authScheduler.getCachedHackathons().push(unverifiedCandidate);

    // Direct ID request for unverified event without include_unverified returns 404 (withheld)
    const blockedSingleResp = await fetch(`http://localhost:${authPort}/api/v1/hackathons/pesu_ann_unverified_test_123`, {
      headers: { Authorization: `Bearer ${testSecretKey}` },
    });
    assert(
      blockedSingleResp.status === 404,
      'GET /api/v1/hackathons/:id returns 404 for unverified item when include_unverified is false'
    );

    // Direct ID request with include_unverified=true succeeds
    const allowedSingleResp = await fetch(
      `http://localhost:${authPort}/api/v1/hackathons/pesu_ann_unverified_test_123?include_unverified=true`,
      { headers: { Authorization: `Bearer ${testSecretKey}` } }
    );
    assert(
      allowedSingleResp.status === 200,
      'GET /api/v1/hackathons/:id returns 200 when include_unverified=true'
    );

    // Connection status check
    const connResp = await fetch(`http://localhost:${authPort}/api/v1/connection-status`, {
      headers: { Authorization: `Bearer ${testSecretKey}` },
    });
    assert([200, 502, 503].includes(connResp.status), `GET /api/v1/connection-status returns valid status (${connResp.status})`);
    const connJson = await connResp.json();
    assert(typeof connJson.ok === 'boolean', 'Connection status response contains boolean "ok" property');

    // Test 5.4: Cache protection (Zero-item sync does not overwrite healthy cache)
    console.log('\n--- 7. Testing Cache Protection ---');
    const emptySyncResult = await authScheduler.syncNow({
      htmlFixture: '<html><body><div>No announcements here</div></body></html>',
      enableOcr: false,
    });
    assert(
      emptySyncResult.success === false,
      'Sync returning 0 items reports success: false'
    );
    assert(
      authScheduler.getCachedHackathons().length >= 3,
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
