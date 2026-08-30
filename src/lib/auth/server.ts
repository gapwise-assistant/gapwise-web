import { DEMO_USER_ID } from '@/lib/demo/seed';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { isLocalhostRequest } from '@/lib/runtime/localAuth';
import { getFirebaseAdminAuth } from '@/lib/firebase-admin';
import { StorageError } from '@/lib/storage/types';

export type AccessTier = 'owner' | 'public_demo' | 'local_development' | 'internal_service';

export type AccessCapability =
  | 'public_demo_read'
  | 'public_demo_load'
  | 'public_demo_ask'
  | 'manage_workspace'
  | 'manage_account';

export interface AuthenticatedPrincipal {
  uid: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  provider: 'google' | 'password' | 'anonymous' | 'local' | 'internal';
  accessTier: AccessTier;
}

export type AuthenticatedUser = AuthenticatedPrincipal;

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

function configuredOwnerEmails(): Set<string> {
  return new Set(
    [
      process.env.GAPSWISE_FULL_ACCESS_EMAILS,
      process.env.GAPSWISE_JUDGE_EMAIL,
    ]
      .filter(Boolean)
      .join(',')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isVerifiedOwner(decoded: { email?: string; email_verified?: boolean }): boolean {
  return decoded.email_verified === true
    && Boolean(decoded.email?.trim())
    && configuredOwnerEmails().has(decoded.email!.trim().toLowerCase());
}

/**
 * Resolve identity for a user-scoped route. In production, only Firebase ID
 * tokens or the private server-to-server secret can establish the user.
 */
export async function requireAuthenticatedPrincipal(
  request: Request,
  requestedUserId?: string
): Promise<AuthenticatedPrincipal> {
  if (isDemoMode()) {
    return { uid: DEMO_USER_ID, name: 'Local demo user', emailVerified: false, provider: 'local', accessTier: 'local_development' };
  }

  if (isLocalhostRequest(request)) {
    return { uid: DEMO_USER_ID, name: 'Local development user', emailVerified: false, provider: 'local', accessTier: 'local_development' };
  }

  const internalSecret = process.env.GAPSWISE_INTERNAL_API_SECRET?.trim();
  const suppliedInternalSecret = request.headers.get('x-gapswise-internal-secret');
  if (internalSecret && suppliedInternalSecret === internalSecret) {
    if (!requestedUserId?.trim()) {
      throw new StorageError('Internal requests must include a user ID.', 'UNAUTHENTICATED');
    }
    return { uid: requestedUserId.trim(), emailVerified: false, provider: 'internal', accessTier: 'internal_service' };
  }

  // Unit route tests do not have a Firebase runtime. This branch is never
  // active in a deployed app and keeps route tests focused on route behavior.
  if (process.env.NODE_ENV === 'test' && requestedUserId?.trim()) {
    return { uid: requestedUserId.trim(), emailVerified: false, provider: 'local', accessTier: 'local_development' };
  }

  const token = bearerToken(request);
  if (!token) {
    throw new StorageError('Sign in is required.', 'UNAUTHENTICATED');
  }

  try {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
    requestedUserMatches(decoded.uid, requestedUserId?.trim());
    const signInProvider = decoded.firebase?.sign_in_provider;
    const provider = signInProvider === 'anonymous'
      ? 'anonymous'
      : signInProvider === 'password'
        ? 'password'
        : 'google';
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified === true,
      name: decoded.name,
      provider,
      accessTier: isVerifiedOwner(decoded) ? 'owner' : 'public_demo',
    };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('The sign-in session is invalid or expired.', 'UNAUTHENTICATED');
  }
}

export async function requireAuthenticatedUser(
  request: Request,
  requestedUserId?: string,
): Promise<AuthenticatedUser> {
  return requireAuthenticatedPrincipal(request, requestedUserId);
}

export async function requireAuthenticatedUserId(request: Request, requestedUserId?: string): Promise<string> {
  const principal = await requireAuthenticatedPrincipal(request, requestedUserId);
  assertCapability(principal, 'manage_workspace');
  return principal.uid;
}

/**
 * Central capability boundary for routes. External public-demo users can
 * read their registered demo, load it, and spend the bounded Ask allowance;
 * every mutation and account-management operation remains full-access only.
 */
export function assertCapability(
  principal: AuthenticatedPrincipal,
  capability: AccessCapability,
): void {
  if (principal.accessTier !== 'public_demo') return;
  if (capability === 'public_demo_read' || capability === 'public_demo_load' || capability === 'public_demo_ask') return;
  throw new StorageError('This action is unavailable in the public demo.', 'PERMISSION_DENIED');
}

export function assertFullAccess(principal: AuthenticatedPrincipal): void {
  assertCapability(principal, 'manage_workspace');
}

export function assertStorageUrlBelongsToUser(storageUrl: string, userId: string): void {
  if (!storageUrl.includes(`/users/${userId}/`)) {
    throw new StorageError('The requested asset does not belong to this user.', 'PERMISSION_DENIED');
  }
}
