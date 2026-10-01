import request from 'supertest';
import { app } from '../../src/app.js';
import { newId } from '../../src/lib/ids.js';
import { prisma } from '../../src/lib/prisma.js';

export type Agent = ReturnType<typeof request.agent>;

export const defaultProfile = {
  firstName: 'Ana',
  lastName: 'Lopez',
  address: '123 Main St',
  city: 'Bogota',
  state: 'Cundinamarca',
  postalCode: '110111',
  country: 'CO',
  phone: '+573001234567',
  timeZone: 'America/Bogota',
  avatarUrl: '/avatars/avatar-1.svg',
};

let counter = 0;

/**
 * Signs up a fresh user and returns a cookie-carrying agent.
 * The profile is inserted directly so helpers don't depend on the profile endpoint.
 */
export async function createUserAgent(
  opts: { withProfile?: boolean; timeZone?: string } = {},
): Promise<{ agent: Agent; userId: string; username: string; email: string; password: string }> {
  counter += 1;
  const tag = `${Date.now().toString(36)}${counter}`;
  const username = `user_${tag}`;
  const email = `${username}@example.com`;
  const password = 'Passw0rd!';
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/sign-up/email')
    .set('Origin', 'http://localhost:5173')
    .send({ email, password, name: username, username });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  const userId = (res.body as { user: { id: string } }).user.id;
  if (opts.withProfile ?? true) {
    await prisma.profile.create({
      data: { id: newId(), userId, ...defaultProfile, timeZone: opts.timeZone ?? defaultProfile.timeZone },
    });
  }
  return { agent, userId, username, email, password };
}
