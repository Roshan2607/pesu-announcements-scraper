import {
  ClassifiedHackathon,
  EligibilityInfo,
  EventCategory,
  RawPesuAnnouncement,
  VerificationInfo,
} from '../types.js';

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

const PUBLIC_PLATFORM_PATTERNS = [
  /https?:\/\/([a-zA-Z0-9-]+\.)?devfolio\.co[^\s<>"]*/i,
  /https?:\/\/([a-zA-Z0-9-]+\.)?unstop\.com[^\s<>"]*/i,
  /https?:\/\/forms\.gle\/[^\s<>"]+/i,
  /https?:\/\/docs\.google\.com\/forms[^\s<>"]*/i,
  /https?:\/\/lu\.ma\/[^\s<>"]+/i,
  /https?:\/\/([a-zA-Z0-9-]+\.)?hackerearth\.com[^\s<>"]*/i,
  /https?:\/\/([a-zA-Z0-9-]+\.)?mlh\.io[^\s<>"]*/i,
];

const OFFICIAL_PUBLIC_DOMAINS = [
  /https?:\/\/events\.pes\.edu[^\s<>"]*/i,
  /https?:\/\/([a-zA-Z0-9-]+\.)?pes\.edu[^\s<>"]*/i,
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
 */
export function parseIsoDateRange(text: string, referenceYear = new Date().getFullYear()): {
  start: string | null;
  end: string | null;
} {
  if (!text) return { start: null, end: null };

  const isoMatch = text.match(/\b(202\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    return { start: isoMatch[0], end: isoMatch[0] };
  }

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

/**
 * Extracts eligibility rules, target audience, campus restrictions, and deadline.
 */
export function extractEligibility(combinedText: string): EligibilityInfo {
  // 1. Campus
  let campus: 'RR' | 'EC' | 'ALL' | 'UNKNOWN' = 'UNKNOWN';
  const hasRR = /\b(rr\s+campus|ring\s+road)\b/i.test(combinedText);
  const hasEC = /\b(ec\s+campus|electronic\s+city)\b/i.test(combinedText);
  if (hasRR && hasEC) campus = 'ALL';
  else if (hasRR) campus = 'RR';
  else if (hasEC) campus = 'EC';
  else if (/\b(all\s+campuses?|across\s+campuses)\b/i.test(combinedText)) campus = 'ALL';

  // 2. Departments
  const departments: string[] = [];
  if (/\b(all\s+departments?|all\s+branches?|open\s+to\s+all)\b/i.test(combinedText)) {
    departments.push('ALL');
  } else {
    if (/\b(cse|computer\s+science)\b/i.test(combinedText)) departments.push('CSE');
    if (/\b(ai[\s/&]?ml|artificial\s+intelligence)\b/i.test(combinedText)) departments.push('AIML');
    if (/\b(ece|electronics)\b/i.test(combinedText)) departments.push('ECE');
    if (/\b(eee|electrical)\b/i.test(combinedText)) departments.push('EEE');
    if (/\b(mechanical|mech)\b/i.test(combinedText)) departments.push('MECH');
    if (/\b(biotech|biotechnology)\b/i.test(combinedText)) departments.push('BIOTECH');
  }
  if (departments.length === 0) departments.push('ALL');

  // 3. Target Years
  const targetYears: number[] = [];
  if (/\b(1st\s+year|first\s+year)\b/i.test(combinedText)) targetYears.push(1);
  if (/\b(2nd\s+year|second\s+year)\b/i.test(combinedText)) targetYears.push(2);
  if (/\b(3rd\s+year|third\s+year)\b/i.test(combinedText)) targetYears.push(3);
  if (/\b(4th\s+year|fourth\s+year)\b/i.test(combinedText)) targetYears.push(4);

  // 4. Open to All / National
  const isOpenToAll = /\b(national\s+hackathon|inter[\s-]college|open\s+to\s+all\s+students|all\s+engineering\s+students)\b/i.test(
    combinedText
  );

  // 5. Registration Deadline
  const deadlineMatch = combinedText.match(
    /\b(?:register\s+before|deadline|last\s+date\s+to\s+register|registration\s+closes|by)[:\s]*([0-9]{1,2}(?:st|nd|rd|th)?[\s-]+[a-zA-Z]+(?:[\s-]+[0-9]{4})?)\b/i
  );
  const registrationDeadline = deadlineMatch
    ? parseIsoDateRange(deadlineMatch[1].trim()).start
    : null;

  // 6. Registration Status
  let status: 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'UNKNOWN' = 'UNKNOWN';
  if (registrationDeadline) {
    const todayIso = new Date().toISOString().slice(0, 10);
    status = registrationDeadline < todayIso ? 'REGISTRATION_CLOSED' : 'REGISTRATION_OPEN';
  } else {
    status = 'REGISTRATION_OPEN';
  }

  return {
    campus,
    departments,
    targetYears,
    isOpenToAll,
    status,
    registrationDeadline,
  };
}

/**
 * Validates independent public proof for the event (SSRF/Confidentiality defense).
 */
export function extractVerification(combinedText: string): VerificationInfo {
  let matchedPublicUrl: string | null = null;
  let verificationSource: 'PUBLIC_PLATFORM' | 'OFFICIAL_DOMAIN' | 'UNVERIFIED_PORTAL_ONLY' =
    'UNVERIFIED_PORTAL_ONLY';

  // Check public platforms
  for (const pattern of PUBLIC_PLATFORM_PATTERNS) {
    const match = combinedText.match(pattern);
    if (match) {
      matchedPublicUrl = match[0].trim();
      verificationSource = 'PUBLIC_PLATFORM';
      break;
    }
  }

  // Check official public domains if platform not found
  if (!matchedPublicUrl) {
    for (const pattern of OFFICIAL_PUBLIC_DOMAINS) {
      const match = combinedText.match(pattern);
      if (match) {
        matchedPublicUrl = match[0].trim();
        verificationSource = 'OFFICIAL_DOMAIN';
        break;
      }
    }
  }

  const isIndependentlyVerified = Boolean(matchedPublicUrl);

  return {
    isIndependentlyVerified,
    verificationSource,
    publicProofUrl: matchedPublicUrl,
    requiresAdminReview: !isIndependentlyVerified,
  };
}

export function classifyAnnouncement(ann: RawPesuAnnouncement): ClassifiedHackathon {
  const combinedText = `${ann.title}\n${ann.description}\n${ann.ocrText || ''}`;

  // 1. Routine exclusions check
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

  // 4. Independent Verification & Proof URL
  const verification = extractVerification(combinedText);
  const registrationUrl = verification.publicProofUrl;

  // 5. Cash Prize Extraction
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

  // 7. Eligibility Extraction
  const eligibility = extractEligibility(combinedText);

  // 8. Matchability Determination for Quackathon Team Matching
  let isHackathon = isPotentialHackathon;
  let isMatchable = false;

  if (isExplicitSolo && isPotentialHackathon) {
    isHackathon = false;
    isMatchable = false;
    classificationReason = 'Solo-only contest; excluded from team hackathon matching';
  } else if (isPotentialHackathon) {
    // Event is matchable only if registration is not closed and it's a team-eligible competition
    if (eligibility.status === 'REGISTRATION_CLOSED') {
      isMatchable = false;
      classificationReason = 'Registration deadline has passed; not matchable';
    } else {
      isMatchable = true;
    }
  }

  // 9. Format & Venue Extraction (Explicit text only)
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

  // 10. Validated ISO Date Parsing (Asia/Kolkata)
  // NEVER fall back to publication date for eventDates (Quackathon Core Guarantee)
  const dateTextMatch = `${ann.description} ${ann.ocrText || ''}`.match(
    /\b(?:dates?|held\s+on|event\s+dates?|on)[:\s]*([0-9]{1,2}(?:st|nd|rd|th)?(?:\s*(?:to|-)\s*[0-9]{1,2}(?:st|nd|rd|th)?)?\s+[a-zA-Z]+(?:\s+[0-9]{4})?)/i
  );
  const parsedEventDates = dateTextMatch
    ? parseIsoDateRange(dateTextMatch[1].trim())
    : { start: null, end: null };

  const parsedPublishedDate = parseIsoDateRange(ann.date || '').start || null;

  // 11. Tags
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
    isMatchable,
    organizer,
    publishedDate: parsedPublishedDate,
    eventDates: {
      start: parsedEventDates.start,
      end: parsedEventDates.end,
    },
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
    confidence: isHackathon ? (cashPrize && teamSize ? 'high' : 'medium') : 'low',
    classificationReason,
    eligibility,
    verification,
  };
}
