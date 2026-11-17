import 'dotenv/config';
import { PesuAuthSession } from '../src/services/pesuAuthSession.js';
import { AnnouncementScraper } from '../src/services/announcementScraper.js';

async function runLiveVerification() {
  console.log('====================================================');
  console.log('🌐 PAASHA LIVE PESU ACADEMY INTEGRATION & FETCH TEST');
  console.log('====================================================\n');

  const srn = process.env.PESU_SRN;
  const pwd = process.env.PESU_PASSWORD;

  if (!srn || !pwd || srn === 'PES1UG22CS000' || pwd.includes('your_pesu')) {
    console.log('⚠️  Notice: Live credentials not configured in .env. Skipping live network test.');
    console.log('    To run live verification, set valid PESU_SRN and PESU_PASSWORD in .env\n');
    process.exit(0);
  }

  console.log('[1/3] Authenticating with live PESU Academy portal...');
  const session = new PesuAuthSession(srn, pwd);
  const authResult = await session.login();

  if (!authResult.success) {
    console.error('❌ Authentication failed against PESU Academy.');
    process.exit(1);
  }

  console.log('  ✅ Successfully authenticated (session established).\n');

  console.log('[2/3] Fetching live announcement payload from studentProfilePESUAdmin...');
  const scraper = new AnnouncementScraper(session);
  const startTime = Date.now();
  const envelope = await scraper.fetchEnvelope({
    enableOcr: false,
    maxAnnouncements: 15,
  });
  const duration = Date.now() - startTime;

  if (!envelope || envelope.data.length === 0) {
    console.error('❌ Failed: 0 announcements retrieved from live endpoint.');
    process.exit(1);
  }

  console.log(`  ✅ Live fetch successful in ${duration}ms!`);
  console.log(`  📋 Retrieved ${envelope.data.length} live announcements.`);
  console.log(`  🕒 Envelope fetched_at: ${envelope.fetched_at}\n`);

  console.log('[3/3] Validating stability of announcement IDs and classifications...');
  const firstAnn = envelope.data[0];
  console.log(`  🔹 Sample Item: "${firstAnn.title.slice(0, 50)}..."`);
  console.log(`  🔹 Deterministic ID: ${firstAnn.id}`);
  console.log(`  🔹 Published Date: ${firstAnn.date}`);

  // Test ID stability (hash must be 100% deterministic)
  const recomputedId = scraper.generateStableId(firstAnn.title, firstAnn.date, firstAnn.description);
  if (recomputedId !== firstAnn.id) {
    console.error(`❌ Error: Announcement ID is non-deterministic (${firstAnn.id} != ${recomputedId})`);
    process.exit(1);
  }
  console.log('  ✅ ID determinism verified: Stable across multiple calculations.\n');

  console.log('--- RECENT LIVE PESU ANNOUNCEMENTS (METADATA ONLY) ---');
  envelope.data.slice(0, 5).forEach((ann, idx) => {
    console.log(`  [${idx + 1}] ID: ${ann.id} | Date: ${ann.date}`);
    console.log(`      Title: ${ann.title}`);
  });

  console.log('\n====================================================');
  console.log('🎉 LIVE PESU ACADEMY VERIFICATION PASSED');
  console.log('====================================================\n');
  process.exit(0);
}

runLiveVerification().catch((err) => {
  console.error('Fatal live test error:', err.message || 'Unknown error');
  process.exit(1);
});
