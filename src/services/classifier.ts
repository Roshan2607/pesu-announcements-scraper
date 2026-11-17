import { ClassifiedHackathon, EventCategory, RawPesuAnnouncement } from '../types.js';

// Strict regex patterns using full-word boundaries (\b) to avoid false positives (e.g. "lifehack", "hacked")
const HACKATHON_REGEX = /\b(hackathons?|buildathons?|codeathons?|datathons?|ai\s+sprint)\b/i;
const IDEATHON_REGEX = /\b(ideathons?)\b/i;
const CTF_REGEX = /\b(ctf|capture\s+the\s+flag)\b/i;
const CODING_CONTEST_REGEX = /\b(coding\s+contest|coding\s+competition|competitive\s+programming\s+contest|speed\s+coding)\b/i;
const WORKSHOP_REGEX = /\b(workshops?|bootcamps?|hands-on\s+session|training\s+program|masterclass)\b/i;

// Negative patterns: Announcements that are academic, administrative, or non-competitive talks
const NEGATIVE_EXCLUSIONS_REGEX = /\b(parent[\s-]teacher|ptm|provisional\s+timetable|isa[\s-]?\d+|esa\s+exam|hall\s+ticket|seating\s+allocation|attendance|backlog|convocation|bus\s+pass|fee\s+payment|grievance|guest\s+lecture|talk\s+by|seminar\s+on)\b/i;

const CLUBS = [
  'HackerSpace PESU',
  'HackerSpace',
  'ACM PESU',
  'ACM',
  'IEEE PESU',
  'IEEE',
  'The Alcoding Club',
  'Alcoding Club',
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

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

/**
 * Parses free-form date expressions into validated ISO 8601 (YYYY-MM-DD) date strings.
 * E.g.:
 * "28th - 29th November 2026" -> { start: "2026-11-28", end: "2026-11-29" }
 * "5th December 2026"         -> { start: "2026-12-05", end: "2026-12-05" }
 * "14-November-2026"          -> { start: "2026-11-14", end: "2026-11-14" }
 */
export function parseIsoDateRange(text: string, referenceYear = new Date().getFullYear()): {
  start: string | null;
  end: string | null;
} {
  if (!text) return { start: null, end: null };

  // 1. Check for standard ISO format YYYY-MM-DD
  const isoMatch = text.match(/\b(202\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    return { start: isoMatch[0], end: null };
  }

  // 2. Check for date range: "28th - 29th November 2026" or "28 to 29 November 2026"
  const rangeMatch = text.match(
    /\b([0-9]{1,2})(?:st|nd|rd|th)?\s*(?:-|to)\s*([0-9]{1,2})(?:st|nd|rd|th)?\s+([a-zA-Z]+)(?:\s+(202\d))?\b/i
  );
  if (rangeMatch) {
    const startDay = rangeMatch[1].padStart(2, '0');
    const endDay = rangeMatch[2].padStart(2, '0');
    const monthStr = rangeMatch[3].toLowerCase();
    const month = MONTH_MAP[monthStr];
    const year = rangeMatch[4] || String(referenceYear);

    if (month) {
      return {
        start: `${year}-${month}-${startDay}`,
        end: `${year}-${month}-${endDay}`,
      };
    }
  }

  // 3. Check for single date: "5th December 2026" or "14-November-2026"
  const singleMatch = text.match(
    /\b([0-9]{1,2})(?:st|nd|rd|th)?[\s-]+([a-zA-Z]+)(?:[\s-]+(202\d))?\b/i
  );
  if (singleMatch) {
    const day = singleMatch[1].padStart(2, '0');
    const monthStr = singleMatch[2].toLowerCase();
    const month = MONTH_MAP[monthStr];
    const year = singleMatch[3] || String(referenceYear);

    if (month) {
      const isoDate = `${year}-${month}-${day}`;
      return {
        start: isoDate,
        end: isoDate,
      };
    }
  }

  return { start: null, end: null };
}

export function classifyAnnouncement(ann: RawPesuAnnouncement): ClassifiedHackathon {
  const combinedText = `${ann.title}\n${ann.description}\n${ann.ocrText || ''}`;

  // 1. Check for negative administrative/routine exclusions first
  const isRoutineAdministrative = NEGATIVE_EXCLUSIONS_REGEX.test(ann.title);

  // 2. Strict Category Detection with Word Boundaries
  let category: EventCategory = 'GENERAL_ANNOUNCEMENT';
  let isPotentialHackathon = false;
  let classificationReason = 'Routine or general announcement';

  if (!isRoutineAdministrative) {
    if (IDEATHON_REGEX.test(combinedText)) {
      category = 'IDEATHON';
      isPotentialHackathon = true;
      classificationReason = 'Matched explicit ideathon keyword pattern';
    } else if (HACKATHON_REGEX.test(combinedText)) {
      category = 'HACKATHON';
      isPotentialHackathon = true;
      classificationReason = 'Matched explicit hackathon keyword pattern';
    } else if (CTF_REGEX.test(combinedText)) {
      category = 'CTF';
      isPotentialHackathon = true;
      classificationReason = 'Matched capture-the-flag (CTF) competition pattern';
    } else if (CODING_CONTEST_REGEX.test(combinedText)) {
      category = 'CODING_COMPETITION';
      isPotentialHackathon = false;
      classificationReason = 'Competitive coding contest';
    } else if (WORKSHOP_REGEX.test(combinedText)) {
      category = 'WORKSHOP';
      isPotentialHackathon = false;
      classificationReason = 'Educational workshop or hands-on training';
    }
  } else {
    classificationReason = 'Excluded as administrative, academic circular, or routine notice';
  }

  // 3. Organizer Detection
  let organizer: string | null = null;
  for (const club of CLUBS) {
    if (new RegExp(`\\b${club}\\b`, 'i').test(`${ann.title} ${ann.description}`)) {
      organizer = club;
      break;
    }
  }

  // 4. Registration URLs (e.g. Devfolio, Unstop, Google Forms, Luma, HackerEarth)
  const urlRegex = /https?:\/\/[^\s<>"]+/g;
  const urls = `${ann.description} ${ann.ocrText || ''}`.match(urlRegex) || [];
  const registrationUrl =
    urls.find((u) =>
      /devfolio\.co|unstop\.com|forms\.gle|docs\.google\.com\/forms|lu\.ma|hackerearth\.com|pes\.edu/i.test(u)
    ) || urls[0] || null;

  // 5. Cash Prize Extraction (e.g. ₹1,00,000, 50K, 1 Lakh, $500, Cash Prize of Rs 25,000)
  const prizeRegex =
    /(?:cash\s+prize(?:\s+pool)?|prize\s+pool|prizes\s+worth|prizes?\s+of)\s*(?:of|up\s+to|:)?\s*(₹|rs\.?|inr|\$)?\s*([0-9]+(?:,[0-9]+)*(?:\s*(?:k|lakhs?|cr))?)/i;
  const prizeMatch = `${ann.title} ${ann.description} ${ann.ocrText || ''}`.match(prizeRegex);
  let cashPrize: string | null = null;
  if (prizeMatch) {
    cashPrize = prizeMatch[0].trim();
  }

  // 6. Explicit Team Size ONLY - NEVER ASSUME OR INVENT CONSTRAINTS
  let teamSize: { min: number; max: number } | null = null;
  const isExplicitSolo = /\b(individual\s+participation|solo\s+participants?|single\s+player)\b/i.test(
    combinedText
  );

  const teamRangeMatch = `${ann.description} ${ann.ocrText || ''}`.match(
    /\b(?:teams?\s+of|team\s+size[:\s]*)\s*([1-9])\s*(?:-|to)\s*([1-9])\b/i
  );
  const teamUpToMatch = `${ann.description} ${ann.ocrText || ''}`.match(
    /\b(?:teams?\s+of\s+up\s+to|maximum\s+team\s+size\s*(?:of|is)?)\s*([1-9])\b/i
  );
  const teamExactMatch = `${ann.description} ${ann.ocrText || ''}`.match(
    /\b(?:teams?\s+of|team\s+size\s*[:=]\s*)\s*([1-9])(?:\s+members?)?\b/i
  );

  if (teamRangeMatch) {
    teamSize = {
      min: parseInt(teamRangeMatch[1], 10),
      max: parseInt(teamRangeMatch[2], 10),
    };
  } else if (teamUpToMatch) {
    teamSize = {
      min: 1,
      max: parseInt(teamUpToMatch[1], 10),
    };
  } else if (teamExactMatch) {
    const size = parseInt(teamExactMatch[1], 10);
    // If "team of 4" is stated, exact size is 4. Do NOT assume min: 1 unless stated!
    teamSize = {
      min: size,
      max: size,
    };
  } else if (isExplicitSolo) {
    teamSize = { min: 1, max: 1 };
  }
  // If no team size is mentioned, teamSize remains null!

  // 7. Team Verification for Matchability
  // If an event is explicitly solo, it is not a team hackathon matchable in Quackathon
  let isHackathon = isPotentialHackathon;
  if (isExplicitSolo && isPotentialHackathon) {
    isHackathon = false;
    classificationReason = 'Solo-only contest; excluded from team hackathon matching';
  }

  // 8. Format & Venue Extraction (Explicit text only)
  let format: 'onsite' | 'online' | 'hybrid' | 'unknown' = 'unknown';
  if (/\bhybrid\b/i.test(combinedText)) format = 'hybrid';
  else if (/\b(online|virtual|zoom|discord|google\s+meet)\b/i.test(combinedText)) format = 'online';
  else if (/\b(offline|in-person|onsite|on-campus)\b/i.test(combinedText)) format = 'onsite';

  let venue: string | null = null;
  const venueExplicitMatch = `${ann.description} ${ann.ocrText || ''}`.match(
    /\b(?:venue|location|held\s+at)[:\s]*([^\n,.]+)/i
  );
  if (venueExplicitMatch) {
    venue = venueExplicitMatch[1].trim();
  } else if (/\brr\s+campus\b/i.test(combinedText)) {
    venue = 'RR Campus';
  } else if (/\bec\s+campus|electronic\s+city\b/i.test(combinedText)) {
    venue = 'EC Campus';
  }

  // 9. Validated ISO Date Parsing (Asia/Kolkata)
  // NEVER fall back to publication date for eventDates (Quackathon Core Guarantee)
  const dateTextMatch = `${ann.description} ${ann.ocrText || ''}`.match(
    /\b(?:dates?|held\s+on|event\s+dates?|on)[:\s]*([0-9]{1,2}(?:st|nd|rd|th)?(?:\s*(?:to|-)\s*[0-9]{1,2}(?:st|nd|rd|th)?)?\s+[a-zA-Z]+(?:\s+[0-9]{4})?)/i
  );
  const parsedEventDates = dateTextMatch
    ? parseIsoDateRange(dateTextMatch[1].trim())
    : { start: null, end: null };

  const parsedPublishedDate = parseIsoDateRange(ann.date || '').start || null;

  // 10. Tags
  const tags: string[] = [];
  if (isHackathon) tags.push('hackathon');
  if (/\b(ai|ml|machine\s+learning|deep\s+learning)\b/i.test(combinedText)) tags.push('ai-ml');
  if (/\b(web3|blockchain|crypto|solana|ethereum)\b/i.test(combinedText)) tags.push('web3');
  if (/\b(cybersecurity|infosec|ctf)\b/i.test(combinedText)) tags.push('security');
  if (format !== 'unknown') tags.push(format);
  if (cashPrize) tags.push('prizes');

  return {
    id: ann.id,
    title: ann.title,
    category,
    isHackathon,
    organizer,
    publishedDate: parsedPublishedDate,
    eventDates: {
      start: parsedEventDates.start,
      end: parsedEventDates.end,
    },
    registrationDeadline: null,
    registrationUrl,
    cashPrize,
    teamSize, // Null if unstated
    format,
    venue, // Null if unstated
    posterUrl: ann.image,
    ocrExtracted: Boolean(ann.ocrText),
    ocrSnippet: ann.ocrText ? ann.ocrText.substring(0, 150) + '...' : null,
    description: ann.description,
    tags,
    confidence: isHackathon ? (cashPrize && teamSize ? 'high' : 'medium') : 'low',
    classificationReason,
  };
}
