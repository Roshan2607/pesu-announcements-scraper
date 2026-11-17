import { Request, Response, NextFunction } from 'express';

/**
 * Authentication middleware securing announcements and hackathon endpoints.
 * Requires either 'Authorization: Bearer <token>' or 'X-API-Key: <token>'.
 */
export function requireApiAuth(req: Request, res: Response, next: NextFunction): void {
  const secretKey = process.env.API_SECRET_KEY || process.env.SCRAPER_API_KEY;

  // If no secret key is explicitly configured, protect in development with a default warning
  if (!secretKey) {
    if (process.env.NODE_ENV === 'production') {
      res.status(500).json({
        ok: false,
        error: 'Server security misconfiguration: API_SECRET_KEY must be set in production.',
      });
      return;
    }
    // Allow development requests to proceed with a notice if neither header nor key is provided
    next();
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

  if (!providedToken || providedToken !== secretKey) {
    res.status(401).json({
      ok: false,
      error: 'Unauthorized: Missing or invalid API key / Bearer token.',
      userMessage: 'Provide a valid Bearer token in the Authorization header.',
    });
    return;
  }

  next();
}
