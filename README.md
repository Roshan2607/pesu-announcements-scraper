### **P**ESU **A**cademy **A**nnouncements **S**craper & **H**ackathon **A**PI

**PAASHA** is a hardened, automated event scraper, flyer OCR processor, and hackathon ingestion service built specifically for **[Quackathon](https://github.com/Roshan2607/Quackathon)**.

---

## Architecture & Security Model

### 1. Independent Service Architecture (No Password Storage in Quackathon)
- **Zero Student Credential Storage**: Quackathon students authenticate via PESU OAuth2 with PKCE. Quackathon **never** collects, receives, or stores student Academy passwords.
- **Dedicated Ingestion Bot**: This scraper runs as an independent backend ingestion worker using a single dedicated university service account configured via server-side environment secrets (`PESU_SRN` and `PESU_PASSWORD`).
- **Restricted Data Scope**: Exposes **only independently verified, non-personal hackathon metadata** to Quackathon (`/api/v1/hackathons` and `/api/v1/quackathon/events`). The raw announcement feed (`/api/v1/announcements`) is restricted by default so internal circulars and department-specific notices are never broadcast.

### 2. Fail-Closed Authentication (`API_SECRET_KEY`)
- All data and trigger endpoints under `/api/v1/*` are secured with Bearer token authentication (`Authorization: Bearer <API_SECRET_KEY>`) or `X-API-Key`.
- **Fails closed in every environment**: If `API_SECRET_KEY` is not configured, the service refuses all API requests with HTTP 500 (`Server Misconfiguration`).

### 3. Attack Prevention & OCR Sandboxing (SSRF & Resource Limits)
- Poster images passed to Tesseract OCR are strictly validated:
  - **Origin Allowlist & Validated Redirects**: Only HTTPS URLs from `www.pesuacademy.com`, `pesuacademy.com`, and `files.pesuacademy.com` are accepted. Redirects are handled manually with destination URLs re-validated at each hop.
  - **Streaming Size Enforcement**: Enforces the 5 MB limit chunk-by-chunk during streaming to prevent large payloads from filling RAM.
  - **Active Download Timeout**: The download timeout remains armed throughout the entire body stream, clearing only upon completion or abort.
  - **Magic Bytes Validation**: Image buffers are inspected to verify genuine image headers (PNG, JPEG, WebP, GIF) before execution.
  - **Concurrency & Serialization**: OCR tasks run sequentially through an execution queue, preventing CPU/memory exhaustion.
  - **Idle Auto-Termination**: Tesseract WebAssembly workers automatically terminate after 45 seconds of idle inactivity to reclaim memory.
- **Sync Fixture Protection**: Custom `htmlFixture` payloads are rejected with HTTP 403 unless explicitly running under `NODE_ENV=test`.

### 4. Cache Protection & Collision-Resistant IDs
- **Collision-Resistant Hashing**: Computes deterministic SHA-256 hashes incorporating title, date, and content snippet: `pesu_ann_${sha256(title + '|' + date + '|' + snippet).slice(0, 16)}`. Two notices with the same title on the same date will never collide or overwrite each other.
- **Healthy Cache Preservation**: If a sync run unexpectedly yields 0 announcements (e.g. temporary network anomaly or layout update), the scheduler refuses to overwrite the existing healthy cache.

### 5. Strict Classifier, Calendar Validity & Active Public-Source Verification
- **Active Public-Source Verification**: Candidate public links (Devfolio, Unstop, Google Forms, Luma, HackerEarth, `events.pes.edu`) are captured as `candidateProofUrl`. An active `SourceVerifier` fetches the landing page with SSRF safeguards, confirms it is accessible, and verifies distinctive title/organizer keywords before marking `isIndependentlyVerified = true`.
- **Zero Presumed Registration**: Unstated registration deadlines remain `status: 'UNKNOWN'`, never defaulting to `REGISTRATION_OPEN`.
- **Confirmed Team Eligibility for Matchability**: Unknown team size (`teamSize: null`) or solo events keep `isMatchable = false`. "Find Teammates" eligibility is strictly gated to confirmed team competitions (`teamSize.max > 1`) that are independently verified.
- **Real Calendar Validity**: Free-form and ISO dates are checked for real calendar validity (rejecting invalid dates like February 31 or November 31).
- **Direct ID Access Gating**: `GET /api/v1/hackathons/:id` applies the exact same verification filter as listing, returning 404 for unverified items unless `include_unverified=true` is authorized.

---

## Project Structure
```
pesu-announcements-scraper/
├── src/
│   ├── index.ts                     # Express server & lifecycle
│   ├── types.ts                     # TypeScript definitions & Quackathon envelope
│   ├── middleware/
│   │   └── auth.ts                  # Fail-closed Bearer token security middleware
│   ├── routes/
│   │   └── api.ts                   # Protected REST endpoints (/hackathons, /sync, /connection-status)
│   └── services/
│       ├── pesuAuthSession.ts       # Portal session handshake & cookie jar
│       ├── announcementScraper.ts   # HTML parser & collision-resistant ID generator
│       ├── ocrService.ts            # SSRF-protected streaming Tesseract OCR engine
│       ├── classifier.ts            # Strict classifier, ISO date & eligibility parser
│       ├── sourceVerifier.ts        # Active public landing page & relevance verifier
│       └── cronScheduler.ts         # In-memory cache, deduplication & recurring job
├── tests/
│   ├── fixtures/
│   │   └── sampleAnnouncements.ts   # Edge-case test fixtures
│   ├── verify.test.ts               # Unit & security test suite (52 assertions)
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

### 2. Configure Environment (`.env`)
```env
# Dedicated Service Account for Ingestion
PESU_SRN=PES1UG22CS000
PESU_PASSWORD=your_service_account_password

# API Security: Secret Bearer token required for all /api/v1/* requests
API_SECRET_KEY=change_me_to_a_secure_random_token_12345

# Server Configuration
PORT=4000
CRON_SCHEDULE=*/30 * * * *
DISABLE_CRON=false
EXPOSE_RAW_ANNOUNCEMENTS=false
```

### 3. Run Tests
```bash
# Unit, security, and classifier verification (45 assertions)
npm test

# Real-time live verification against PESU Academy (redacts all credentials/tokens)
npm run test:live
```

### 4. Start Server
```bash
npm run dev
```

---

## API Endpoints Reference

All endpoints under `/api/v1/*` require `Authorization: Bearer <API_SECRET_KEY>`.

### 1. `GET /api/v1/connection-status`
Performs an active health handshake against the live PESU Academy portal to verify session status, network connectivity, and latency:
```bash
curl -H "Authorization: Bearer <API_SECRET_KEY>" http://localhost:4000/api/v1/connection-status
```
```json
{
  "ok": true,
  "portalLive": true,
  "sessionActive": true,
  "latencyMs": 112,
  "checkedAt": "2026-11-17T16:07:07.157Z",
  "syncStatus": {
    "isSyncing": false,
    "lastSync": "2026-11-17T16:07:07.157Z",
    "cachedAnnouncements": 15,
    "cachedHackathons": 0,
    "lastError": null
  }
}
```

### 2. `GET /api/v1/hackathons`
Returns filtered and verified hackathons, ideathons, and technical competitions:
- Query parameters:
  - `matchable_only=true`: Filters only events eligible for student team matching
  - `include_unverified=true`: Includes internal notices pending public proof verification
  - `category=HACKATHON`: Filter by category (`HACKATHON`, `IDEATHON`, `CTF`, `CODING_COMPETITION`)
  - `format=onsite`: Filter by format (`onsite`, `online`, `hybrid`)

```bash
curl -H "Authorization: Bearer <API_SECRET_KEY>" http://localhost:4000/api/v1/hackathons?matchable_only=true
```
```json
{
  "ok": true,
  "total": 1,
  "synced_at": "2026-11-17T16:00:00.000Z",
  "hackathons": [
    {
      "id": "pesu_ann_8ab156bebf8be199",
      "title": "HackerSpace HackFest 2026: 24-Hour National Hackathon",
      "category": "HACKATHON",
      "isHackathon": true,
      "isMatchable": true,
      "organizer": "HackerSpace PESU",
      "publishedDate": "2026-11-14",
      "eventDates": {
        "start": "2026-11-28",
        "end": "2026-11-29"
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
      "ocrSnippet": "PRIZE POOL 100K REG DEVFOLIO...",
      "tags": ["hackathon", "ai-ml", "web3", "onsite", "prizes"],
      "confidence": "high",
      "classificationReason": "Matched explicit hackathon keyword pattern",
      "eligibility": {
        "campus": "RR",
        "departments": ["CSE"],
        "targetYears": [],
        "isOpenToAll": true,
        "status": "REGISTRATION_OPEN",
        "registrationDeadline": null
      },
      "verification": {
        "isIndependentlyVerified": true,
        "verificationSource": "PUBLIC_PLATFORM",
        "publicProofUrl": "https://hackerspace-pesu.devfolio.co",
        "requiresAdminReview": false
      }
    }
  ]
}
```

### 3. `GET /api/v1/quackathon/events`
Returns verified hackathons formatted in the normalized Quackathon envelope:
```bash
curl -H "Authorization: Bearer <API_SECRET_KEY>" http://localhost:4000/api/v1/quackathon/events
```
```json
{
  "resource": "announcements",
  "fetched_at": "2026-11-17T16:00:00.000Z",
  "data": [
    {
      "id": "pesu_ann_8ab156bebf8be199",
      "title": "HackerSpace HackFest 2026: 24-Hour National Hackathon",
      "date": "2026-11-14",
      "description": "The Department of CSE in collaboration with HackerSpace...",
      "image": "https://www.pesuacademy.com/MAcademy/img/announcements/hackfest.jpg",
      "attachments": 0,
      "ocrText": "PRIZE POOL 100K REG DEVFOLIO"
    }
  ]
}
```

### 4. `POST /api/v1/sync`
Manually triggers an immediate scrape and OCR extraction:
```bash
curl -X POST -H "Authorization: Bearer <API_SECRET_KEY>" http://localhost:4000/api/v1/sync
```

### 5. `GET /health`
Public health diagnostic endpoint (no token required).

---

## Quackathon Integration Guide

Configure Quackathon with its **own dedicated scraper service URL and secret key** (do not reuse `issuerBaseUrl`, which is reserved for the PESU OAuth authorization server):

```env
# Inside Quackathon's .env:
HACKATHON_SCRAPER_SERVICE_URL=http://localhost:4000
HACKATHON_SCRAPER_API_KEY=your_configured_api_secret_key
```

In Quackathon's `server.ts` or sync worker:
```typescript
const scraperUrl = `${process.env.HACKATHON_SCRAPER_SERVICE_URL}/api/v1/quackathon/events`;
const resp = await fetch(scraperUrl, {
  headers: {
    Authorization: `Bearer ${process.env.HACKATHON_SCRAPER_API_KEY}`,
    Accept: 'application/json',
  },
});

if (resp.ok) {
  const envelope = await resp.json();
  const normalized = normalizePesuAnnouncementPayload(envelope);
  // Ingest verified hackathon candidates without duplicates
}
```
      "isHackathon": true,
      "organizer": "HackerSpace PESU",
      "publishedDate": "2026-11-14",
      "eventDates": {
        "start": "2026-11-28",
        "end": "2026-11-29"
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

### 2. `GET /api/v1/quackathon/events`
Returns verified hackathons formatted in the normalized Quackathon envelope:
```bash
curl -H "Authorization: Bearer <API_SECRET_KEY>" http://localhost:4000/api/v1/quackathon/events
```
```json
{
  "resource": "announcements",
  "fetched_at": "2026-11-17T15:56:08.366Z",
  "data": [
    {
      "id": "pesu_ann_8ab156bebf8be199",
      "title": "HackerSpace HackFest 2026: 24-Hour National Hackathon",
      "date": "2026-11-14",
      "description": "The Department of CSE in collaboration with HackerSpace...",
      "image": "https://www.pesuacademy.com/MAcademy/img/announcements/hackfest.jpg",
      "attachments": 0,
      "ocrText": "PRIZE POOL 100K REG DEVFOLIO"
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

## Quackathon Integration Guide

Configure Quackathon with its **own dedicated scraper service URL and secret key** (do not reuse `issuerBaseUrl`, which is reserved for the PESU OAuth authorization server):

```env
# Inside Quackathon's .env:
HACKATHON_SCRAPER_SERVICE_URL=http://localhost:4000
HACKATHON_SCRAPER_API_KEY=your_configured_api_secret_key
```

In Quackathon's `server.ts` or sync worker:
```typescript
const scraperUrl = `${process.env.HACKATHON_SCRAPER_SERVICE_URL}/api/v1/quackathon/events`;
const resp = await fetch(scraperUrl, {
  headers: {
    Authorization: `Bearer ${process.env.HACKATHON_SCRAPER_API_KEY}`,
    Accept: 'application/json',
  },
});

if (resp.ok) {
  const envelope = await resp.json();
  const normalized = normalizePesuAnnouncementPayload(envelope);
  // Ingest verified hackathon candidates without duplicates
}
```
