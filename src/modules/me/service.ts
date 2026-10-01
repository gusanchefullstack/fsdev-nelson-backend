import { AppError } from '../../errors.js';
import { newId } from '../../lib/ids.js';
import { prisma } from '../../lib/prisma.js';
import type { Theme } from '../../generated/prisma/enums.js';
import type { ProfileInput } from './schemas.js';

const profileSelect = {
  firstName: true,
  lastName: true,
  address: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  phone: true,
  timeZone: true,
  avatarUrl: true,
} as const;

export async function getMe(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, username: true, theme: true, profile: { select: profileSelect } },
  });
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    theme: user.theme,
    profile: user.profile ? { ...user.profile, username: user.username ?? '' } : null,
  };
}

export async function upsertProfile(userId: string, input: ProfileInput) {
  const { username, ...profile } = input;
  const taken = await prisma.user.findFirst({ where: { username, NOT: { id: userId } }, select: { id: true } });
  if (taken) {
    throw new AppError(409, 'CONFLICT', 'That username is already taken.', { username: 'Already taken' });
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { username, displayUsername: username, name: `${profile.firstName} ${profile.lastName}` },
    }),
    prisma.profile.upsert({
      where: { userId },
      create: { id: newId(), userId, ...profile },
      update: profile,
    }),
  ]);
  return getMe(userId);
}

export async function updateTheme(userId: string, theme: Theme): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { theme } });
}

export async function setAvatar(userId: string, avatarUrl: string): Promise<void> {
  await prisma.profile.updateMany({ where: { userId }, data: { avatarUrl } });
}
