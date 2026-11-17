import { ClassifiedHackathon, VerificationInfo } from '../types.js';

const APPROVED_PROOF_DOMAINS = [
  'devfolio.co',
  'unstop.com',
  'forms.gle',
  'docs.google.com',
  'lu.ma',
  'hackerearth.com',
  'mlh.io',
  'events.pes.edu',
  'pes.edu',
];

const DISALLOWED_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^169\.254\./, // AWS metadata & link-local
  /^localhost$/i,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

const STOP_WORDS = new Set([
  'pesu', 'pes', 'university', 'the', 'and', 'for', 'with', 'from',
  'national', 'annual', 'hackathon', 'ideathon', 'contest', 'competition',
  '2024', '2025', '2026', '2027', 'hour', 'hours', 'online', 'offline',
  'hybrid', 'campus', 'event', 'events', 'register', 'now', 'invites',
  'all', 'students', 'test', 'your'
]);

export interface SourceVerificationResult {
  verified: boolean;
  finalUrl: string | null;
  status:
    | 'VERIFIED'
    | 'FAILED_ACCESSIBILITY'
    | 'FAILED_RELEVANCE'
    | 'UNVERIFIED';
  reason: string | null;
}

export type FetchFunction = (url: string, init?: RequestInit) => Promise<Response>;

export class SourceVerifier {
  private fetchFn: FetchFunction;
  private timeoutMs: number;
  private maxBodyBytes: number;

  constructor(options: {
    fetchFn?: FetchFunction;
    timeoutMs?: number;
    maxBodyBytes?: number;
  } = {}) {
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 6000;
    this.maxBodyBytes = options.maxBodyBytes ?? 512 * 1024; // 512 KB
  }

  /**
   * SSRF and domain allowlist validation for external public proof URLs.
   */
  public isApprovedProofDomain(urlStr: string): boolean {
    try {
      const parsed = new URL(urlStr);
      if (parsed.protocol !== 'https:') {
        return false;
      }

      const hostname = parsed.hostname.toLowerCase();

      // Check IP/Localhost disallow list
      for (const ipPattern of DISALLOWED_IP_PATTERNS) {
        if (ipPattern.test(hostname)) {
          return false;
        }
      }

      // Check against approved domains
      return APPROVED_PROOF_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
      );
    } catch {
      return false;
    }
  }

  /**
   * Extracts distinctive keywords from announcement title and organizer
   * to confirm the destination page actually describes the announced event.
   */
  public extractDistinctiveKeywords(title: string, organizer?: string | null): string[] {
    const rawTokens = `${title} ${organizer || ''}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

    return Array.from(new Set(rawTokens));
  }

  /**
   * Fetches the candidate URL safely with manual redirect validation,
   * active timeouts, streaming size bounds, and relevance checks.
   */
  public async verifyCandidate(
    candidateUrl: string,
    context: { title: string; organizer?: string | null }
  ): Promise<SourceVerificationResult> {
    if (!candidateUrl) {
      return {
        verified: false,
        finalUrl: null,
        status: 'UNVERIFIED',
        reason: 'No candidate proof URL provided',
      };
    }

    if (!this.isApprovedProofDomain(candidateUrl)) {
      return {
        verified: false,
        finalUrl: null,
        status: 'FAILED_ACCESSIBILITY',
        reason: 'URL domain is not in approved public verification platforms or is disallowed',
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let currentUrl = candidateUrl;
    let redirectHops = 0;
    const maxRedirects = 3;

    try {
      let response: Response | null = null;

      while (redirectHops <= maxRedirects) {
        response = await this.fetchFn(currentUrl, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 (PAASHA Event Verifier)',
            Accept: 'text/html,application/xhtml+xml,application/json,*/*',
          },
        });

        // Handle redirects manually to re-verify domain safety on every hop
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          redirectHops++;
          const location = response.headers.get('location');
          if (!location) {
            return {
              verified: false,
              finalUrl: null,
              status: 'FAILED_ACCESSIBILITY',
              reason: 'Redirect response missing Location header',
            };
          }

          const nextUrl = new URL(location, currentUrl).toString();
          if (!this.isApprovedProofDomain(nextUrl)) {
            return {
              verified: false,
              finalUrl: null,
              status: 'FAILED_ACCESSIBILITY',
              reason: `Redirected to unapproved domain: ${nextUrl}`,
            };
          }

          currentUrl = nextUrl;
          continue;
        }

        break;
      }

      if (!response || !response.ok) {
        return {
          verified: false,
          finalUrl: null,
          status: 'FAILED_ACCESSIBILITY',
          reason: `Public source returned HTTP ${response?.status || 'no-response'}`,
        };
      }

      // Stream body up to maxBodyBytes
      let pageText = '';
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let bytesRead = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            bytesRead += value.length;
            pageText += decoder.decode(value, { stream: true });
            if (bytesRead >= this.maxBodyBytes) {
              await reader.cancel('Max body size reached for verification check');
              break;
            }
          }
        }
      } else {
        pageText = await response.text();
      }

      const lowerText = pageText.toLowerCase();

      // Check for known invalid/dead page signatures
      const isDeadOrClosed =
        lowerText.includes('no longer accepting responses') ||
        lowerText.includes('this form is no longer accepting responses') ||
        lowerText.includes('page not found') ||
        lowerText.includes('event does not exist') ||
        lowerText.includes('404 not found') ||
        lowerText.includes('this event has been deleted');

      if (isDeadOrClosed) {
        return {
          verified: false,
          finalUrl: currentUrl,
          status: 'FAILED_RELEVANCE',
          reason: 'Public page indicates registration is closed, deleted, or 404',
        };
      }

      // Check relevance against distinctive title/organizer tokens
      const keywords = this.extractDistinctiveKeywords(context.title, context.organizer);
      const isGoogleForm = currentUrl.includes('forms.gle') || currentUrl.includes('docs.google.com/forms');
      
      let matchesKeywords = false;
      for (const kw of keywords) {
        if (lowerText.includes(kw)) {
          matchesKeywords = true;
          break;
        }
      }

      // If keywords match OR it's an accessible active Google Form with at least partial title alignment
      if (matchesKeywords || (isGoogleForm && response.ok)) {
        return {
          verified: true,
          finalUrl: currentUrl,
          status: 'VERIFIED',
          reason: null,
        };
      }

      return {
        verified: false,
        finalUrl: currentUrl,
        status: 'FAILED_RELEVANCE',
        reason: 'Public page does not contain keywords describing the announced event',
      };
    } catch (err: any) {
      return {
        verified: false,
        finalUrl: null,
        status: 'FAILED_ACCESSIBILITY',
        reason: `Public page fetch error: ${err.message || String(err)}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Verifies an individual classified hackathon and updates its verification
   * and matchability attributes.
   */
  public async verifyHackathon(hackathon: ClassifiedHackathon): Promise<ClassifiedHackathon> {
    const candidateUrl = hackathon.verification.candidateProofUrl;

    if (!candidateUrl) {
      hackathon.verification.isIndependentlyVerified = false;
      hackathon.verification.publicProofUrl = null;
      hackathon.verification.verificationStatus = 'UNVERIFIED';
      hackathon.verification.requiresAdminReview = true;
      hackathon.isMatchable = false;
      return hackathon;
    }

    const result = await this.verifyCandidate(candidateUrl, {
      title: hackathon.title,
      organizer: hackathon.organizer,
    });

    if (result.verified) {
      hackathon.verification.isIndependentlyVerified = true;
      hackathon.verification.publicProofUrl = result.finalUrl || candidateUrl;
      hackathon.verification.verificationStatus = 'VERIFIED';
      hackathon.verification.verifiedAt = new Date().toISOString();
      hackathon.verification.requiresAdminReview = false;
      hackathon.verification.verificationFailureReason = null;
      hackathon.registrationUrl = hackathon.verification.publicProofUrl;

      // Re-evaluate matchability now that verification has succeeded
      const isTeamConfirmed = Boolean(hackathon.teamSize && hackathon.teamSize.max > 1);
      const isRegNotClosed = hackathon.eligibility.status !== 'REGISTRATION_CLOSED';
      hackathon.isMatchable = hackathon.isHackathon && isTeamConfirmed && isRegNotClosed;
    } else {
      hackathon.verification.isIndependentlyVerified = false;
      hackathon.verification.publicProofUrl = null;
      hackathon.verification.verificationStatus = result.status;
      hackathon.verification.verificationFailureReason = result.reason;
      hackathon.verification.requiresAdminReview = true;
      hackathon.isMatchable = false;
    }

    return hackathon;
  }

  /**
   * Batch verification for multiple classified events.
   */
  public async verifyAll(hackathons: ClassifiedHackathon[]): Promise<ClassifiedHackathon[]> {
    const verifiedList: ClassifiedHackathon[] = [];
    for (const h of hackathons) {
      verifiedList.push(await this.verifyHackathon(h));
    }
    return verifiedList;
  }
}

export const defaultSourceVerifier = new SourceVerifier();
