import { DEMO_USER_ID } from '@/lib/demo/seed';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { isLocalhostRequest } from '@/lib/runtime/localAuth';
import { getFirebaseAdminAuth } from '@/lib/firebase-admin';
import { StorageError } from '@/lib/storage/types';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  name?: string;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

function requestedUserMatches(uid: string, requestedUserId?: string): void {
  if (requestedUserId && requestedUserId !== uid) {
    throw new StorageError('The requested user does not match the authenticated account.', 'PERMISSION_DENIED');
  }
}

/**
 * Resolve identity for a user-scoped route. In production, only Firebase ID
 * tokens or the private server-to-server secret can establish the user.
 */
export async function requireAuthenticatedUser(
  request: Request,
  requestedUserId?: string
): Promise<AuthenticatedUser> {
  if (isDemoMode()) {
    return { uid: DEMO_USER_ID, name: 'Local demo user' };
  }

  if (isLocalhostRequest(request)) {
    return { uid: DEMO_USER_ID, name: 'Local development user' };
  }

  const internalSecret = process.env.GAPSWISE_INTERNAL_API_SECRET?.trim();
  const suppliedInternalSecret = request.headers.get('x-gapswise-internal-secret');
  if (internalSecret && suppliedInternalSecret === internalSecret) {
    if (!requestedUserId?.trim()) {
      throw new StorageError('Internal requests must include a user ID.', 'UNAUTHENTICATED');
    }
    return { uid: requestedUserId.trim() };
  }

  // Unit route tests do not have a Firebase runtime. This branch is never
  // active in a deployed app and keeps route tests focused on route behavior.
  if (process.env.NODE_ENV === 'test' && requestedUserId?.trim()) {
    return { uid: requestedUserId.trim() };
  }

  const token = bearerToken(request);
  if (!token) {
    throw new StorageError('Sign in is required.', 'UNAUTHENTICATED');
  }

  try {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
    requestedUserMatches(decoded.uid, requestedUserId?.trim());
    return {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
    };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('The sign-in session is invalid or expired.', 'UNAUTHENTICATED');
  }
}

export async function requireAuthenticatedUserId(request: Request, requestedUserId?: string): Promise<string> {
  return (await requireAuthenticatedUser(request, requestedUserId)).uid;
}

export function assertStorageUrlBelongsToUser(storageUrl: string, userId: string): void {
  if (!storageUrl.includes(`/users/${userId}/`)) {
    throw new StorageError('The requested asset does not belong to this user.', 'PERMISSION_DENIED');
  }
}
