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

export function classifyAnnouncement(ann: RawPesuAnnouncement): ClassifiedHackathon {
  const combinedText = `${ann.title}\n${ann.description}\n${ann.ocrText || ''}`;

  // 1. Check for negative administrative/routine exclusions first
  const isRoutineAdministrative = NEGATIVE_EXCLUSIONS_REGEX.test(ann.title);

  // 2. Strict Category Detection with Word Boundaries
  let category: EventCategory = 'GENERAL_ANNOUNCEMENT';
  let isHackathon = false;
  let classificationReason = 'Routine or general announcement';

  if (!isRoutineAdministrative) {
    if (IDEATHON_REGEX.test(combinedText)) {
      category = 'IDEATHON';
      isHackathon = true;
      classificationReason = 'Matched explicit ideathon keyword pattern';
    } else if (HACKATHON_REGEX.test(combinedText)) {
      category = 'HACKATHON';
      isHackathon = true;
      classificationReason = 'Matched explicit hackathon keyword pattern';
    } else if (CTF_REGEX.test(combinedText)) {
      category = 'CTF';
      isHackathon = true; // CTFs are matchable technical team competitions
      classificationReason = 'Matched capture-the-flag (CTF) competition pattern';
    } else if (CODING_CONTEST_REGEX.test(combinedText)) {
      category = 'CODING_COMPETITION';
      isHackathon = false;
      classificationReason = 'Matched competitive coding competition';
    } else if (WORKSHOP_REGEX.test(combinedText)) {
      category = 'WORKSHOP';
      isHackathon = false;
      classificationReason = 'Educational workshop or hands-on training';
    }
  } else {
    classificationReason = 'Excluded as administrative, academic circular, or routine notice';
  }

  // 3. Organizer Detection (Only if clearly present)
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

  // 6. Explicit Team Size ONLY - NEVER INVENT OR DEFAULT CONSTRAINTS
  let teamSize: { min: number; max: number } | null = null;
  const teamRangeMatch = `${ann.description} ${ann.ocrText || ''}`.match(
    /\b(?:teams?\s+of|team\s+size[:\s]*)\s*([1-9])\s*(?:-|to)\s*([1-9])\b/i
  );
  const teamSingleMatch = `${ann.description} ${ann.ocrText || ''}`.match(
    /\b(?:teams?\s+of|team\s+size[:\s]*)\s*([1-9])(?:\s+members?)?\b/i
  );
  const soloMatch = /\b(individual|solo\s+participants?)\b/i.test(combinedText);

  if (teamRangeMatch) {
    teamSize = {
      min: parseInt(teamRangeMatch[1], 10),
      max: parseInt(teamRangeMatch[2], 10),
    };
  } else if (soloMatch && !teamSingleMatch) {
    teamSize = { min: 1, max: 1 };
  } else if (teamSingleMatch) {
    const size = parseInt(teamSingleMatch[1], 10);
    teamSize = { min: 1, max: size };
  }
  // Note: If no team size is explicitly found, teamSize remains null.
  // We NEVER assume 2-4 members unless stated!

  // 7. Format & Venue Extraction (Explicit text only)
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

  // 8. Event Dates (Explicit text only)
  const dateRangeRegex =
    /\b(?:dates?|held\s+on|on)[:\s]*([0-9]{1,2}(?:st|nd|rd|th)?\s*(?:-|to)?\s*[0-9]{1,2}?(?:st|nd|rd|th)?\s+[a-zA-Z]+(?:\s+[0-9]{4})?)/i;
  const dateMatch = `${ann.description} ${ann.ocrText || ''}`.match(dateRangeRegex);
  const eventStart = dateMatch ? dateMatch[1].trim() : null;

  // 9. Tags
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
    publishedDate: ann.date || null,
    eventDates: {
      start: eventStart,
      end: null,
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
