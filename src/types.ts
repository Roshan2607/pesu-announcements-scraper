export type EventCategory = 
  | 'HACKATHON' 
  | 'IDEATHON' 
  | 'CTF' 
  | 'CODING_COMPETITION' 
  | 'WORKSHOP' 
  | 'GENERAL_ANNOUNCEMENT';

export interface RawPesuAnnouncement {
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

export interface ClassifiedHackathon {
  id: string;
  title: string;
  category: EventCategory;
  isHackathon: boolean;
  organizer: string;
  publishedDate: string | null;
  eventDates: {
    start: string | null;
    end: string | null;
  };
  registrationDeadline: string | null;
  registrationUrl: string | null;
  cashPrize: string | null;
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
}
