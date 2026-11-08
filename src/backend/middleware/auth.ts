import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { createHash, timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string): boolean {
  // Hash first so both buffers have equal length; avoids leaking length via timing.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * HTTP Basic Auth. The browser shows its native login dialog and then sends the
 * credentials with every same-origin request (API calls, <img>, <video>, downloads).
 * Disabled when user or password is empty.
 */
export function basicAuth(user: string, password: string, exemptPaths: string[] = []): RequestHandler {
  const enabled = user !== '' && password !== '';

  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled || exemptPaths.includes(req.path)) return next();

    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep >= 0) {
        const u = decoded.slice(0, sep);
        const p = decoded.slice(sep + 1);
        // Evaluate both comparisons to keep timing constant.
        const okUser = safeEqual(u, user);
        const okPass = safeEqual(p, password);
        if (okUser && okPass) return next();
      }
    }

    res.set('WWW-Authenticate', 'Basic realm="Modellbahn Kamera", charset="UTF-8"');
    res.status(401).json({ error: 'Authentication required' });
  };
}
