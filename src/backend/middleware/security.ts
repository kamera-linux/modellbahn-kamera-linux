import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Basic hardening headers for API responses and the SPA. */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer'
  });
  next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection. The browser re-sends cached Basic-Auth credentials even when a
 * foreign web page submits a form to this server, so state-changing requests must
 * come from our own origin (or an origin explicitly listed in CORS_ORIGINS).
 *
 * Browsers send Sec-Fetch-Site; older ones at least Origin. Requests with neither
 * (curl, scripts) are not browser-initiated and are allowed.
 */
export function sameOriginOnly(allowedOrigins: string[] = []): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) return next();

    const site = req.headers['sec-fetch-site'];
    if (typeof site === 'string') {
      if (site === 'same-origin' || site === 'none') return next();
      return res.status(403).json({ error: 'Cross-site request rejected' });
    }

    if (origin) {
      let host: string | null = null;
      try {
        host = new URL(origin).host;
      } catch {
        host = null;
      }
      if (host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request rejected' });
    }
    next();
  };
}
