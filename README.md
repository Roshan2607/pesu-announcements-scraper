# PESU Academy Announcements Scraper & Hackathon Ingestion API

A lightweight, automated scraper service built for PES University (PESU) ecosystem applications like **[Quackathon](https://github.com/Roshan2607/Quackathon)**.

## Architecture & Security Model
- **Independent Ingestion Microservice**: This service runs as an autonomous background bot using a single, dedicated server-side credential (`PESU_SRN` / `PESU_PASSWORD`) configured via environment secrets. **Individual student users of Quackathon never provide, handle, or store their PESU Academy passwords.**
- **Token-Authenticated API (`API_SECRET_KEY`)**: All data retrieval and manual sync endpoints (`/api/v1/*`) are secured by Bearer token authorization (`Authorization: Bearer <API_SECRET_KEY>`), preventing unauthorized external access.
- **Deterministic ID Generation**: Computes content-hashed IDs (`pesu_ann_<sha256>`) so that repeated scrapes across hours or service restarts never produce duplicate records in Quackathon's database.
- **Strict Classifier & No Fabricated Constraints**:
  - Uses strict word boundaries (`\bhackathons?\b`, `\bideathons?\b`, `\bctf\b`) to avoid false positives (e.g. "lifehack", "hacked servers").
  - Routines, seminars, and academic circulars (fees, timetables, PTMs, hall tickets) are explicitly filtered out.
  - **Never invents team bounds or venues**: If team constraints or venues are unstated in the announcement/flyer, `teamSize` and `venue` remain `null`.
- **Tesseract OCR Integration**: Automatically processes announcement flyers (`img.img-responsive`) using `tesseract.js` (WebAssembly) to extract dates, cash prizes, and registration links embedded inside posters.

---

## Project Structure
```
pesu-announcements-scraper/
├── src/
│   ├── index.ts                     # Express server & graceful lifecycle
│   ├── types.ts                     # TypeScript definitions & Quackathon envelope
│   ├── middleware/
│   │   └── auth.ts                  # Bearer token security middleware (API_SECRET_KEY)
│   ├── routes/
│   │   └── api.ts                   # Protected REST endpoints (/announcements, /hackathons, /sync)
│   └── services/
│       ├── pesuAuthSession.ts       # Portal session handshake & cookie jar
│       ├── announcementScraper.ts   # HTML parser & deterministic ID generator
│       ├── ocrService.ts            # Tesseract OCR engine (tesseract.js)
│       ├── classifier.ts            # Strict competition detection (no fabricated constraints)
│       └── cronScheduler.ts         # In-memory cache, deduplication & recurring job
├── tests/
│   ├── fixtures/
│   │   └── sampleAnnouncements.ts   # Comprehensive test fixtures
│   ├── verify.test.ts               # Unit & integration verification test suite
│   └── live-fetch.test.ts           # Real-time portal authentication & live-fetch test
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
# Dedicated Service Account for Background Scraping
PESU_SRN=PES1UG22CS000
PESU_PASSWORD=your_service_account_password

# API Security: Secret Bearer token required for all /api/v1/* requests
API_SECRET_KEY=change_me_to_a_secure_random_token_12345

# Server Configuration
PORT=4000
CRON_SCHEDULE=*/30 * * * *
DISABLE_CRON=false
```

### 3. Run Tests
```bash
# Unit & synthetic fixture test suite (35 assertions)
npm test

# Real-time live verification against PESU Academy
npm run test:live
```

### 4. Start Server
```bash
npm run dev
```

---

## API Endpoints Reference

All endpoints under `/api/v1/*` require `Authorization: Bearer <API_SECRET_KEY>`.

### 1. `GET /api/v1/announcements`
Returns the normalized envelope directly consumable by Quackathon's `normalizePesuAnnouncementPayload()`:
```bash
curl -H "Authorization: Bearer <API_SECRET_KEY>" http://localhost:4000/api/v1/announcements
```
```json
{
  "resource": "announcements",
  "fetched_at": "2026-11-17T15:44:57.613Z",
  "data": [
    {
      "id": "pesu_ann_7b1aceae249e9ce8",
      "title": "HackerSpace HackFest 2026: 24-Hour National Hackathon",
      "date": "14-November-2026",
      "description": "The Department of CSE in collaboration with HackerSpace...",
      "image": "https://www.pesuacademy.com/MAcademy/img/announcements/hackfest.jpg",
      "attachments": 1,
      "ocrText": "PRIZE POOL 100K REG DEVFOLIO"
    }
  ]
}
```

### 2. `GET /api/v1/hackathons`
Returns only filtered and parsed hackathons, ideathons, and technical competitions:
```bash
curl -H "Authorization: Bearer <API_SECRET_KEY>" http://localhost:4000/api/v1/hackathons
```
```json
{
  "ok": true,
  "total": 1,
  "synced_at": "2026-11-17T15:44:57.613Z",
  "hackathons": [
    {
      "id": "pesu_ann_7b1aceae249e9ce8",
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
      "confidence": "high",
      "classificationReason": "Matched explicit hackathon keyword pattern"
    }
  ]
}
```

### 3. `POST /api/v1/sync`
Manually triggers an immediate scrape and OCR extraction:
```bash
curl -X POST -H "Authorization: Bearer <API_SECRET_KEY>" http://localhost:4000/api/v1/sync
```

### 4. `GET /health`
Public health diagnostic endpoint (no token required).

---

## Quackathon Integration

In Quackathon's `server.ts`, configure the announcements call to include the secret bearer token:
```typescript
const announcementsUrl = `${issuerBaseUrl}/api/v1/announcements`;
const upstreamResp = await fetch(announcementsUrl, {
  headers: {
    Authorization: `Bearer ${process.env.SCRAPER_API_KEY}`,
    Accept: 'application/json',
  },
});
```
Quackathon will then ingest the announcements with zero duplicate records due to the deterministic `pesu_ann_<sha256>` IDs.
