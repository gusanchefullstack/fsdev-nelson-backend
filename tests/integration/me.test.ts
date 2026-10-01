import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { createUserAgent, defaultProfile } from '../helpers/agents.js';
import { resetDb } from '../helpers/db.js';

const ORIGIN = { Origin: 'http://localhost:5173' };

beforeAll(resetDb);

describe('sign-up and login (FR-001, FR-002)', () => {
  it('rejects a duplicate email and a duplicate username', async () => {
    const { email, username } = await createUserAgent({ withProfile: false });
    const dupEmail = await request(app)
      .post('/api/auth/sign-up/email')
      .set(ORIGIN)
      .send({ email, password: 'Passw0rd!', name: 'x', username: 'someone_else' });
    expect(dupEmail.status).toBeGreaterThanOrEqual(400);
    const dupUsername = await request(app)
      .post('/api/auth/sign-up/email')
      .set(ORIGIN)
      .send({ email: 'other@example.com', password: 'Passw0rd!', name: 'x', username });
    expect(dupUsername.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects a password without a digit', async () => {
    const res = await request(app)
      .post('/api/auth/sign-up/email')
      .set(ORIGIN)
      .send({ email: 'nodigit@example.com', password: 'onlyletters', name: 'x', username: 'nodigit' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/letter and one number/);
  });

  it('logs in by username, and wrong passwords get a generic message', async () => {
    const { username, password } = await createUserAgent();
    const ok = await request(app).post('/api/auth/sign-in/username').set(ORIGIN).send({ username, password });
    expect(ok.status).toBe(200);
    const bad = await request(app).post('/api/auth/sign-in/username').set(ORIGIN).send({ username, password: 'Wrong1234' });
    expect(bad.status).toBe(401);
    const unknown = await request(app)
      .post('/api/auth/sign-in/username')
      .set(ORIGIN)
      .send({ username: 'nobody_here', password: 'Wrong1234' });
    // Same message whether the user exists or not
    expect((unknown.body as { message: string }).message).toBe((bad.body as { message: string }).message);
  });
});

describe('profile (FR-003–FR-005)', () => {
  it('blocks the app until the profile is complete', async () => {
    const { agent } = await createUserAgent({ withProfile: false });
    const me = await agent.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.profile).toBeNull();
    const blocked = await agent.get('/api/v1/budgets');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('validates every field with friendly per-field messages', async () => {
    const { agent, username } = await createUserAgent({ withProfile: false });
    const res = await agent
      .put('/api/v1/me/profile')
      .send({ ...defaultProfile, username, phone: '+571', timeZone: 'Mars/Olympus', firstName: '' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['phone', 'timeZone', 'firstName']));
    expect(JSON.stringify(res.body)).not.toMatch(/stack|Error:/);
  });

  it('saves the profile and then allows the app', async () => {
    const { agent, username } = await createUserAgent({ withProfile: false });
    const res = await agent.put('/api/v1/me/profile').send({ ...defaultProfile, username });
    expect(res.status).toBe(200);
    expect(res.body.profile.timeZone).toBe('America/Bogota');
    expect((await agent.get('/api/v1/budgets')).status).not.toBe(403);
  });

  it('rejects a username taken by another user', async () => {
    const other = await createUserAgent();
    const { agent } = await createUserAgent({ withProfile: false });
    const res = await agent.put('/api/v1/me/profile').send({ ...defaultProfile, username: other.username });
    expect(res.status).toBe(409);
    expect(res.body.error.fields).toHaveProperty('username');
  });

  it('stores the theme preference (FR-045)', async () => {
    const { agent } = await createUserAgent();
    expect((await agent.patch('/api/v1/me/preferences').send({ theme: 'DARK' })).status).toBe(204);
    expect((await agent.get('/api/v1/me')).body.theme).toBe('DARK');
  });

  it('requires a session', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
