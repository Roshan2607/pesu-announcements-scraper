import * as cheerio from 'cheerio';

export interface SessionAuthResult {
  success: boolean;
  username?: string;
  csrfToken?: string;
  error?: string;
}

export class PesuAuthSession {
  private academyBaseUrl = 'https://www.pesuacademy.com/Academy';
  private cookies: Map<string, string> = new Map();
  private authenticatedCsrfToken: string | null = null;
  private authenticatedAt: number | null = null;
  private readonly sessionTtlMs = 25 * 60 * 1000; // 25 minutes

  constructor(
    private username: string = process.env.PESU_SRN || '',
    private password: string = process.env.PESU_PASSWORD || ''
  ) {}

  public getCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  public getAuthCsrfToken(): string | null {
    return this.authenticatedCsrfToken;
  }

  public isAuthenticated(): boolean {
    if (!this.authenticatedAt || !this.authenticatedCsrfToken) return false;
    return Date.now() - this.authenticatedAt < this.sessionTtlMs;
  }

  public invalidate() {
    this.cookies.clear();
    this.authenticatedCsrfToken = null;
    this.authenticatedAt = null;
  }

  private extractCookies(resp: Response) {
    let rawCookies: string[] = [];
    if (typeof (resp.headers as any).getSetCookie === 'function') {
      rawCookies = (resp.headers as any).getSetCookie();
    } else {
      const raw = resp.headers.get('set-cookie');
      if (raw) {
        rawCookies = raw.split(/,(?=\s*[\w-]+=[^;]+)/);
      }
    }

    for (const cookieStr of rawCookies) {
      const pair = cookieStr.split(';')[0]?.trim();
      if (!pair) continue;
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;
      const key = pair.substring(0, eqIndex).trim();
      const val = pair.substring(eqIndex + 1).trim();

      if (
        key &&
        !['path', 'domain', 'expires', 'httponly', 'secure', 'samesite', 'max-age'].includes(
          key.toLowerCase()
        )
      ) {
        this.cookies.set(key, val);
      }
    }
  }

  /**
   * Complete, robust authentication against PESU Academy Web Portal
   */
  async login(user = this.username, pass = this.password): Promise<SessionAuthResult> {
    if (!user || !pass) {
      return {
        success: false,
        error: 'PESU credentials missing. Set PESU_SRN and PESU_PASSWORD in .env',
      };
    }

    const defaultHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      Origin: 'https://www.pesuacademy.com',
      Referer: 'https://www.pesuacademy.com/Academy/',
    };

    try {
      console.log(`[PesuAuthSession] Initiating authentication for ${user.slice(0, 4)}...`);

      // Step 1: GET initial landing page to grab initial cookies & login CSRF token
      const r0 = await fetch(`${this.academyBaseUrl}/`, {
        method: 'GET',
        headers: defaultHeaders,
      });
      this.extractCookies(r0);
      const html0 = await r0.text();
      const $0 = cheerio.load(html0);
      const initialCsrf =
        $0('meta[name="csrf-token"]').attr('content') ||
        $0('input[name="_csrf"]').attr('value') ||
        '';

      if (!initialCsrf) {
        return { success: false, error: 'Could not extract login CSRF token from PESU Academy' };
      }

      // Step 2: POST credentials to /Academy/j_spring_security_check
      const loginPayload = new URLSearchParams({
        j_username: user,
        j_password: pass,
        _csrf: initialCsrf,
      });

      const rLogin = await fetch(`${this.academyBaseUrl}/j_spring_security_check`, {
        method: 'POST',
        headers: {
          ...defaultHeaders,
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: this.getCookieHeader(),
        },
        body: loginPayload.toString(),
        redirect: 'manual',
      });
      this.extractCookies(rLogin);

      if (rLogin.status !== 302) {
        return {
          success: false,
          error: `Authentication failed: expected 302 redirect, got status ${rLogin.status}`,
        };
      }

      const loc1 = rLogin.headers.get('Location') || '';
      if (loc1.toLowerCase().includes('authfailed') || loc1.toLowerCase().includes('login')) {
        return {
          success: false,
          error: 'Authentication failed: Invalid SRN/PRN or Password',
        };
      }

      // Step 3: GET /Academy/a/0 (returns 302 to /Academy/s/studentProfilePESU)
      const redirectUrl1 = loc1.startsWith('http') ? loc1 : `https://www.pesuacademy.com${loc1}`;
      const rA0 = await fetch(redirectUrl1, {
        method: 'GET',
        headers: {
          ...defaultHeaders,
          Cookie: this.getCookieHeader(),
        },
        redirect: 'manual',
      });
      this.extractCookies(rA0);

      // Step 4: GET /Academy/s/studentProfilePESU to establish profile session & extract authenticated CSRF
      const loc2 = rA0.headers.get('Location') || '/Academy/s/studentProfilePESU';
      const redirectUrl2 = loc2.startsWith('http') ? loc2 : `https://www.pesuacademy.com${loc2}`;
      const rProfile = await fetch(redirectUrl2, {
        method: 'GET',
        headers: {
          ...defaultHeaders,
          Cookie: this.getCookieHeader(),
        },
      });
      this.extractCookies(rProfile);
      const profileHtml = await rProfile.text();
      const $prof = cheerio.load(profileHtml);
      const authCsrf = $prof('meta[name="csrf-token"]').attr('content') || '';

      if (!authCsrf) {
        return {
          success: false,
          error: 'Authenticated CSRF token could not be retrieved from student profile page',
        };
      }

      this.authenticatedCsrfToken = authCsrf;
      this.authenticatedAt = Date.now();
      console.log(`[PesuAuthSession] Authentication successful for ${user}!`);
      return {
        success: true,
        username: user,
        csrfToken: authCsrf,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Network error during PESU login: ${err.message}`,
      };
    }
  }

  async ensureAuthenticated(): Promise<boolean> {
    if (this.isAuthenticated()) return true;
    const res = await this.login();
    if (!res.success) {
      console.error(`[PesuAuthSession] Login failed: ${res.error}`);
    }
    return res.success;
  }
}
