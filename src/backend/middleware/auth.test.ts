import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { basicAuth } from './auth.js';

const appWith = (user: string, pass: string) => {
  const app = express();
  app.use(basicAuth(user, pass));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  return app;
};

describe('basicAuth', () => {
  it('is a no-op when not configured', async () => {
    await request(appWith('', '')).get('/x').expect(200);
  });

  it('rejects missing or wrong credentials', async () => {
    const app = appWith('admin', 'secret');
    const res = await request(app).get('/x').expect(401);
    expect(res.headers['www-authenticate']).toMatch(/^Basic/);
    await request(app).get('/x').auth('admin', 'wrong').expect(401);
    await request(app).get('/x').auth('other', 'secret').expect(401);
  });

  it('accepts correct credentials, including ":" in the password', async () => {
    await request(appWith('admin', 'secret')).get('/x').auth('admin', 'secret').expect(200);
    await request(appWith('admin', 'a:b:c')).get('/x').auth('admin', 'a:b:c').expect(200);
  });
});
