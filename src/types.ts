export type EventCategory = 
  | 'HACKATHON' 
  | 'IDEATHON' 
  | 'CTF' 
  | 'CODING_COMPETITION' 
  | 'WORKSHOP' 
  | 'GENERAL_ANNOUNCEMENT';

export interface RawPesuAnnouncement {
  /** Stable, deterministic identifier generated from content hash or upstream ID */
  id: string;
  title: string;
  date: string;
  description: string;
  image: string | null;
  attachments: number;
  ocrText?: string | null;
}

/**
 * Envelope matching Quackathon's normalizePesuAnnouncementPayload expectation:
 * { resource: "announcements", fetched_at: "...", data: [...] }
 */
export interface QuackathonAnnouncementEnvelope {
  resource: 'announcements';
  fetched_at: string;
  data: RawPesuAnnouncement[];
}

export interface EligibilityInfo {
  campus: 'RR' | 'EC' | 'ALL' | 'UNKNOWN';
  departments: string[];
  targetYears: number[];
  isOpenToAll: boolean;
  status: 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'UNKNOWN';
  registrationDeadline: string | null;
}

export interface VerificationInfo {
  /** True only if event has an external/public URL proof confirming it is not a confidential circular */
  isIndependentlyVerified: boolean;
  verificationSource: 'PUBLIC_PLATFORM' | 'OFFICIAL_DOMAIN' | 'UNVERIFIED_PORTAL_ONLY';
  publicProofUrl: string | null;
  requiresAdminReview: boolean;
}

export interface ClassifiedHackathon {
  id: string;
  title: string;
  category: EventCategory;
  isHackathon: boolean;
  /** Whether the event is eligible for student team matching in Quackathon */
  isMatchable: boolean;
  organizer: string | null;
  publishedDate: string | null;
  eventDates: {
    start: string | null;
    end: string | null;
  };
  registrationUrl: string | null;
  cashPrize: string | null;
  /** Explicit team size ONLY if stated in text/poster. NEVER fabricated. */
  teamSize: {
    min: number;
    max: number;
  } | null;
  format: 'onsite' | 'online' | 'hybrid' | 'unknown';
  venue: string | null;
  posterUrl: string | null;
  ocrExtracted: boolean;
  ocrSnippet?: string | null;
  description: string;
  tags: string[];
  confidence: 'high' | 'medium' | 'low';
  classificationReason: string;
  eligibility: EligibilityInfo;
  verification: VerificationInfo;
}
