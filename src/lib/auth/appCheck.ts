import { getAppCheck } from 'firebase-admin/app-check';
import { getFirebaseAdminApp } from '@/lib/firebase-admin';
import { StorageError } from '@/lib/storage/types';

export const PUBLIC_DEMO_APPCHECK_ERROR = 'The public demo is temporarily unavailable.';

/**
 * Public Ask is intentionally fail-closed. App Check must be explicitly
 * enabled on the server before an anonymous or non-owner account can spend a
 * public-demo request.
 */
export async function requirePublicDemoAppCheck(request: Request): Promise<void> {
  if (process.env.FIREBASE_APPCHECK_ENABLED?.trim().toLowerCase() !== 'true') {
    throw new StorageError(PUBLIC_DEMO_APPCHECK_ERROR, 'CONFIGURATION_ERROR');
  }
  const token = request.headers.get('x-firebase-appcheck')?.trim();
  if (!token) throw new StorageError(PUBLIC_DEMO_APPCHECK_ERROR, 'PERMISSION_DENIED');
  try {
    await getAppCheck(getFirebaseAdminApp()).verifyToken(token);
  } catch {
    throw new StorageError(PUBLIC_DEMO_APPCHECK_ERROR, 'PERMISSION_DENIED');
  }
}
