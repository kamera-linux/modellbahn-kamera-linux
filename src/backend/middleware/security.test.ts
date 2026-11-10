import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sameOriginOnly, securityHeaders } from './security.js';

const appWith = (allowed: string[] = []) => {
  const app = express();
  app.use(securityHeaders);
  app.use(sameOriginOnly(allowed));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  app.post('/x', (_req, res) => res.json({ ok: true }));
  return app;
};

describe('securityHeaders', () => {
  it('sets nosniff and forbids framing', async () => {
    const res = await request(appWith()).get('/x').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});

describe('sameOriginOnly', () => {
  it('always allows safe methods', async () => {
    await request(appWith()).get('/x').set('Sec-Fetch-Site', 'cross-site').expect(200);
  });

  it('allows non-browser clients without Origin/Sec-Fetch-Site', async () => {
    await request(appWith()).post('/x').expect(200);
  });

  it('decides by Sec-Fetch-Site when present', async () => {
    await request(appWith()).post('/x').set('Sec-Fetch-Site', 'same-origin').expect(200);
    await request(appWith()).post('/x').set('Sec-Fetch-Site', 'cross-site').expect(403);
    await request(appWith()).post('/x').set('Sec-Fetch-Site', 'same-site').expect(403);
  });

  it('falls back to comparing Origin with Host', async () => {
    const app = appWith();
    await request(app).post('/x').set('Host', 'pi5:8000').set('Origin', 'http://pi5:8000').expect(200);
    await request(app).post('/x').set('Host', 'pi5:8000').set('Origin', 'http://evil.example').expect(403);
    await request(app).post('/x').set('Host', 'pi5:8000').set('Origin', 'null').expect(403);
  });

  it('allows origins listed in CORS_ORIGINS', async () => {
    await request(appWith(['http://dev:5173']))
      .post('/x')
      .set('Origin', 'http://dev:5173')
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(200);
  });
});
