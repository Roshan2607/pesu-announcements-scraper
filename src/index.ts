import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createApiRouter } from './routes/api.js';
import { CronScheduler } from './services/cronScheduler.js';
import { ocrService } from './services/ocrService.js';

const app = express();
const port = parseInt(process.env.PORT || '4000', 10);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const scheduler = new CronScheduler();
app.use(createApiRouter(scheduler));

// Start background cron if configured (default: every 30 mins)
const cronSchedule = process.env.CRON_SCHEDULE || '*/30 * * * *';
if (process.env.DISABLE_CRON !== 'true') {
  scheduler.startCron(cronSchedule);
}

const server = app.listen(port, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 PAASHA: PESU Academy Announcements Scraper & Hackathon API`);
  console.log(`📡 URL: http://localhost:${port}`);
  console.log(`📋 Announcements Endpoint: http://localhost:${port}/api/v1/announcements`);
  console.log(`🏆 Hackathons Endpoint:    http://localhost:${port}/api/v1/hackathons`);
  console.log(`🦆 Quackathon Feed:        http://localhost:${port}/api/v1/quackathon/events`);
  console.log(`💓 Connection Status:      http://localhost:${port}/api/v1/connection-status`);
  console.log(`🔄 Sync Endpoint:          POST http://localhost:${port}/api/v1/sync`);
  console.log(`⏰ Background Cron:        ${cronSchedule}`);
  console.log(`======================================================\n`);
});

// Graceful cleanup
process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...');
  scheduler.stopCron();
  await ocrService.terminate();
  server.close(() => process.exit(0));
});

export { app, scheduler };
