# PESU Academy Announcements Scraper & Hackathon Ingestion API

A lightweight, automated scraper service built for PES University (PESU) ecosystem applications like **[Quackathon](https://github.com/Roshan2607/Quackathon)**.

## Highlights
- **Zero Browser Dependencies (No Selenium / Chrome)**: Uses the reverse-engineered `Vision2822/pesu-oauth2` HTTP session flow (`/mobile/dispatcher` + `/j_spring_security_check`) with automatic cookie persistence (`JSESSIONID`, `AWSALB`).
- **Tesseract OCR Integration**: Automatically downloads hackathon flyers/posters (`img.img-responsive`) and extracts dates, registration links, cash prizes, and team constraints using `tesseract.js` (WebAssembly).
- **Native Quackathon Compatibility**: Directly produces the exact envelope (`{ resource: 'announcements', fetched_at: '...', data: [...] }`) consumed by Quackathon's `normalizePesuAnnouncementPayload()`.
- **Dual Trigger**: Functions as both an automated background Cron job (default: every 30m) and an on-demand REST API (`POST /api/v1/sync`).

---

## Project Structure
```
pesu-announcements-scraper/
├── src/
│   ├── index.ts                     # Express server & graceful lifecycle
│   ├── types.ts                     # TypeScript definitions & Quackathon envelope
│   ├── routes/
│   │   └── api.ts                   # REST endpoints (/announcements, /hackathons, /sync)
│   └── services/
│       ├── pesuAuthSession.ts       # HTTP authentication & cookie jar management
│       ├── announcementScraper.ts   # HTML parser & poster downloader
│       ├── ocrService.ts            # Tesseract OCR engine (tesseract.js)
│       ├── classifier.ts            # Hackathon/Ideathon/CTF detection & entity extraction
│       └── cronScheduler.ts         # In-memory cache, deduplication & recurring job
├── tests/
│   ├── fixtures/
│   │   └── sampleAnnouncements.ts   # Realistic PESU Academy announcement fixtures
│   └── verify.test.ts               # End-to-end verification test suite (36 assertions)
├── package.json
└── tsconfig.json
```

---

## Setup & Running

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Credentials (`.env`)
Create a `.env` file in the root directory:
```env
PESU_SRN=PES1UG22CS000
PESU_PASSWORD=your_pesu_academy_password
PORT=4000
CRON_SCHEDULE=*/30 * * * *
DISABLE_CRON=false
```

### 3. Run Tests
```bash
npm test
```

### 4. Start Server
```bash
npm run dev
```

---

## API Endpoints Reference

### 1. `GET /api/v1/announcements`
Returns the raw, normalized envelope compatible with Quackathon's `normalizePesuAnnouncementPayload()`:
```json
{
  "resource": "announcements",
  "fetched_at": "2026-11-17T13:26:41.675Z",
  "data": [
    {
      "id": "pesu_ann_1794922001675_1",
      "title": "HackerSpace HackFest 2026: 24-Hour National Hackathon",
      "date": "14-November-2026",
      "description": "The Department of CSE in collaboration with HackerSpace...",
      "image": "https://www.pesuacademy.com/MAcademy/img/announcements/hackfest.jpg",
      "attachments": 1,
      "ocrText": "CASH PRIZE POOL 100K REG DEVFOLIO"
    }
  ]
}
```

### 2. `GET /api/v1/hackathons`
Returns only filtered and parsed hackathons, ideathons, and technical competitions:
```json
{
  "ok": true,
  "total": 1,
  "synced_at": "2026-11-17T13:26:41.675Z",
  "hackathons": [
    {
      "id": "pesu_ann_1794922001675_1",
      "title": "HackerSpace HackFest 2026: 24-Hour National Hackathon",
      "category": "HACKATHON",
      "isHackathon": true,
      "organizer": "HackerSpace",
      "publishedDate": "14-November-2026",
      "eventDates": {
        "start": "28th - 29th November 2026",
        "end": null
      },
      "registrationUrl": "https://hackerspace-pesu.devfolio.co",
      "cashPrize": "Cash Prize Pool: ₹1,00,000",
      "teamSize": {
        "min": 2,
        "max": 4
      },
      "format": "onsite",
      "venue": "RR Campus",
      "posterUrl": "https://www.pesuacademy.com/MAcademy/img/announcements/hackfest.jpg",
      "ocrExtracted": true,
      "tags": ["hackathon", "ai-ml", "web3", "onsite", "prizes"],
      "confidence": "high"
    }
  ]
}
```

### 3. `POST /api/v1/sync`
Manually triggers an immediate scrape and OCR extraction:
```bash
curl -X POST http://localhost:4000/api/v1/sync
```

### 4. `GET /health`
Returns health check and sync diagnostics.

---

## Hooking into Quackathon

### Option A: External Microservice
In Quackathon's `server.ts`, set the issuer base URL to `http://localhost:4000`. Quackathon will automatically pull from `http://localhost:4000/api/v1/announcements`.

### Option B: In-Process Integration
Copy `src/services/announcementScraper.ts`, `src/services/pesuAuthSession.ts`, `src/services/ocrService.ts`, and `src/services/classifier.ts` into Quackathon's `src/services/` directory and invoke `scheduler.syncNow()` inside Quackathon's admin routes.
