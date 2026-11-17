import { ClassifiedHackathon, EventCategory, RawPesuAnnouncement } from '../types.js';

const HACKATHON_KEYWORDS = [
  'hackathon',
  'hack',
  'ideathon',
  'buildathon',
  'codeathon',
  'datathon',
  'ai sprint',
];

const CTF_KEYWORDS = ['ctf', 'capture the flag', 'cybersecurity contest'];

const CODING_CONTEST_KEYWORDS = [
  'coding contest',
  'coding competition',
  'competitive programming',
  'speed coding',
  'code golf',
  'alcoding',
];

const WORKSHOP_KEYWORDS = [
  'workshop',
  'bootcamp',
  'hands-on session',
  'training program',
  'masterclass',
];

const CLUBS = [
  'HackerSpace',
  'ACM PESU',
  'ACM',
  'IEEE PESU',
  'IEEE',
  'The Alcoding Club',
  'Alcoding',
  'GDSC PESU',
  'GDSC',
  'Google Developer Group',
  'PES OpenSource',
  'Equinox',
  'Shunya',
  'Department of CSE',
  'Department of ECE',
  'Department of AI & ML',
];

export function classifyAnnouncement(ann: RawPesuAnnouncement): ClassifiedHackathon {
  const combinedText = `${ann.title}\n${ann.description}\n${ann.ocrText || ''}`.toLowerCase();

  // 1. Determine Category
  let category: EventCategory = 'GENERAL_ANNOUNCEMENT';
  let isHackathon = false;

  if (HACKATHON_KEYWORDS.some((k) => combinedText.includes(k))) {
    if (combinedText.includes('ideathon')) {
      category = 'IDEATHON';
    } else {
      category = 'HACKATHON';
    }
    isHackathon = true;
  } else if (CTF_KEYWORDS.some((k) => combinedText.includes(k))) {
    category = 'CTF';
    isHackathon = true; // CTFs are matchable technical team competitions
  } else if (CODING_CONTEST_KEYWORDS.some((k) => combinedText.includes(k))) {
    category = 'CODING_COMPETITION';
  } else if (WORKSHOP_KEYWORDS.some((k) => combinedText.includes(k))) {
    category = 'WORKSHOP';
  }

  // 2. Identify Organizer
  let organizer = 'PES University';
  for (const club of CLUBS) {
    if (new RegExp(`\\b${club}\\b`, 'i').test(`${ann.title} ${ann.description}`)) {
      organizer = club;
      break;
    }
  }

  // 3. Extract Registration Links (Devfolio, Unstop, Google Forms, Luma, etc.)
  const urlRegex = /https?:\/\/[^\s<>"]+/g;
  const urls = `${ann.description} ${ann.ocrText || ''}`.match(urlRegex) || [];
  const registrationUrl =
    urls.find((u) =>
      /devfolio\.co|unstop\.com|forms\.gle|docs\.google\.com\/forms|lu\.ma|hackerearth\.com|pes\.edu/i.test(u)
    ) || urls[0] || null;

  // 4. Extract Cash Prizes (e.g. ₹50,000, 50k, 1 Lakh, $500, Cash Prize of Rs 25,000)
  const prizeRegex =
    /(?:cash\s+prize(?:\s+pool)?|prize\s+pool|prizes\s+worth|win)\s*(?:of|up\s+to|:)?\s*(₹|rs\.?|inr|\$)?\s*([0-9]+(?:,[0-9]+)*(?:\s*(?:k|lakhs?|cr))?)/i;
  const prizeMatch = `${ann.title} ${ann.description} ${ann.ocrText || ''}`.match(prizeRegex);
  let cashPrize: string | null = null;
  if (prizeMatch) {
    cashPrize = prizeMatch[0].trim();
  }

  // 5. Extract Team Size (e.g. "team of 2 to 4", "teams of 2-3 members", "solo or team of 4")
  const teamRegex = /(?:teams?\s+of|team\s+size[:\s]*)\s*([1-9])\s*(?:-|to)\s*([1-9])/i;
  const teamMatch = `${ann.description} ${ann.ocrText || ''}`.match(teamRegex);
  let teamSize: { min: number; max: number } | null = null;
  if (teamMatch) {
    teamSize = {
      min: parseInt(teamMatch[1], 10),
      max: parseInt(teamMatch[2], 10),
    };
  } else if (/individual|solo/i.test(combinedText)) {
    teamSize = { min: 1, max: 1 };
  } else if (isHackathon) {
    teamSize = { min: 2, max: 4 }; // Standard default for PESU hackathons
  }

  // 6. Extract Format & Venue
  let format: 'onsite' | 'online' | 'hybrid' | 'unknown' = 'unknown';
  if (/hybrid/i.test(combinedText)) format = 'hybrid';
  else if (/online|virtual|zoom|discord|google meet/i.test(combinedText)) format = 'online';
  else if (/offline|in-person|campus|audi|hall|gjk|block/i.test(combinedText)) format = 'onsite';

  let venue: string | null = null;
  const venueMatch = `${ann.description} ${ann.ocrText || ''}`.match(
    /(?:venue|location|place)[:\s]*([^\n,.]+)/i
  );
  if (venueMatch) {
    venue = venueMatch[1].trim();
  } else if (/rr campus/i.test(combinedText)) {
    venue = 'RR Campus';
  } else if (/ec campus|electronic city/i.test(combinedText)) {
    venue = 'EC Campus';
  }

  // 7. Extract Dates (e.g. Nov 28 - Nov 29, 28th-29th November 2026, 2026-11-28)
  const dateRangeRegex =
    /(?:date[s]?|held on|on)[:\s]*([0-9]{1,2}(?:st|nd|rd|th)?\s*(?:-|to)?\s*[0-9]{1,2}?(?:st|nd|rd|th)?\s+[a-zA-Z]+(?:\s+[0-9]{4})?)/i;
  const dateMatch = `${ann.description} ${ann.ocrText || ''}`.match(dateRangeRegex);
  const eventStart = dateMatch ? dateMatch[1].trim() : null;

  // 8. Tags
  const tags: string[] = [];
  if (isHackathon) tags.push('hackathon');
  if (/ai|ml|machine learning|deep learning/i.test(combinedText)) tags.push('ai-ml');
  if (/web3|blockchain|crypto|solana|ethereum/i.test(combinedText)) tags.push('web3');
  if (/cybersecurity|infosec|ctf/i.test(combinedText)) tags.push('security');
  if (/cloud|devops|aws|docker/i.test(combinedText)) tags.push('cloud');
  if (format !== 'unknown') tags.push(format);
  if (cashPrize) tags.push('prizes');

  return {
    id: ann.id,
    title: ann.title,
    category,
    isHackathon,
    organizer,
    publishedDate: ann.date || null,
    eventDates: {
      start: eventStart,
      end: null,
    },
    registrationDeadline: null,
    registrationUrl,
    cashPrize,
    teamSize,
    format,
    venue,
    posterUrl: ann.image,
    ocrExtracted: Boolean(ann.ocrText),
    ocrSnippet: ann.ocrText ? ann.ocrText.substring(0, 150) + '...' : null,
    description: ann.description,
    tags,
    confidence: isHackathon ? (cashPrize || teamSize ? 'high' : 'medium') : 'low',
  };
}
