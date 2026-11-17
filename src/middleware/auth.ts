import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Authentication middleware securing announcements and hackathon endpoints.
 * Requires either 'Authorization: Bearer <token>' or 'X-API-Key: <token>'.
 * FAILS CLOSED IN ALL ENVIRONMENTS if API_SECRET_KEY is not configured.
 */
export function requireApiAuth(req: Request, res: Response, next: NextFunction): void {
  const secretKey = process.env.API_SECRET_KEY || process.env.SCRAPER_API_KEY;

  // Fail closed unconditionally in ALL environments
  if (!secretKey) {
    res.status(500).json({
      ok: false,
      error: 'Server security misconfiguration: API_SECRET_KEY is not set.',
      userMessage: 'The scraper API is locked down. Configure API_SECRET_KEY in your .env file.',
    });
    return;
  }

  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];

  let providedToken: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.slice(7).trim();
  } else if (apiKeyHeader && typeof apiKeyHeader === 'string') {
    providedToken = apiKeyHeader.trim();
  }

  if (!providedToken) {
    res.status(401).json({
      ok: false,
      error: 'Unauthorized: Missing API key / Bearer token.',
      userMessage: 'Provide a valid Bearer token in the Authorization header.',
    });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  const providedBuffer = Buffer.from(providedToken);
  const secretBuffer = Buffer.from(secretKey);

  if (
    providedBuffer.length !== secretBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, secretBuffer)
  ) {
    res.status(401).json({
      ok: false,
      error: 'Unauthorized: Invalid API key / Bearer token.',
      userMessage: 'The provided Bearer token is invalid.',
    });
    return;
  }

  next();
}
