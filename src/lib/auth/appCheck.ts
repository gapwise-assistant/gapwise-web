import { getAppCheck } from 'firebase-admin/app-check';
import { getFirebaseAdminApp } from '@/lib/firebase-admin';
import { StorageError } from '@/lib/storage/types';

export const PUBLIC_DEMO_APPCHECK_ERROR = 'The public demo is temporarily unavailable.';

/**
 * App Check is an optional additional boundary for public-demo requests.
 * Authentication, access-tier checks, ownership checks, and quota enforcement
 * remain required regardless of this setting.
 */
export async function requirePublicDemoAppCheck(request: Request): Promise<void> {
  if (process.env.FIREBASE_APPCHECK_ENABLED?.trim().toLowerCase() !== 'true') {
    return;
  }
  const token = request.headers.get('x-firebase-appcheck')?.trim();
  if (!token) throw new StorageError(PUBLIC_DEMO_APPCHECK_ERROR, 'PERMISSION_DENIED');
  try {
    await getAppCheck(getFirebaseAdminApp()).verifyToken(token);
  } catch {
    throw new StorageError(PUBLIC_DEMO_APPCHECK_ERROR, 'PERMISSION_DENIED');
  }
}
