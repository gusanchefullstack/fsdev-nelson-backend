import { put } from '@vercel/blob';
import multer from 'multer';
import { env } from '../../config/env.js';
import { AppError } from '../../errors.js';
import { newId } from '../../lib/ids.js';

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
}).single('file');

/** Stores the photo in Vercel Blob and returns its public URL (FR-004). */
export async function storeAvatar(userId: string, file: Express.Multer.File | undefined): Promise<string> {
  if (!file) throw new AppError(422, 'VALIDATION_FAILED', 'Choose an image to upload.', { file: 'Required' });
  const ext = ALLOWED.get(file.mimetype);
  if (!ext) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Use a JPEG, PNG or WebP image.', { file: 'Unsupported format' });
  }
  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Photo uploads are not available right now. Please pick one of the avatars instead.');
  }
  const blob = await put(`avatars/${userId}-${newId()}.${ext}`, file.buffer, {
    access: 'public',
    contentType: file.mimetype,
    token: env.BLOB_READ_WRITE_TOKEN,
  });
  return blob.url;
}
