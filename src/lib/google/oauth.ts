import { createHash, randomBytes } from 'crypto';
import { google, calendar_v3 } from 'googleapis';
import { getFirestoreClient } from '@/lib/firebase-admin';
import { GoogleIntegrationName } from '@/types/google';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

export interface GoogleOAuthTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  token_type?: string | null;
  expiry_date?: number | null;
}

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth requires GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI.');
  }

  return { clientId, clientSecret, redirectUri };
}

export function createOAuthState(userId: string): string {
  return Buffer.from(JSON.stringify({ userId, nonce: randomBytes(16).toString('hex') })).toString('base64url');
}

export function readOAuthState(value: string): { userId: string; nonce: string } {
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf-8')) as { userId?: string; nonce?: string };
  if (!parsed.userId || !parsed.nonce) {
    throw new Error('Invalid Google OAuth state.');
  }
  return { userId: parsed.userId, nonce: parsed.nonce };
}

function oauthStateHash(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

function oauthStateDocument(state: string) {
  const { userId, nonce } = readOAuthState(state);
  return getFirestoreClient()
    .collection('users')
    .doc(userId)
    .collection('googleOAuthStates')
    .doc(nonce);
}

/** Store OAuth state server-side because some reverse proxies do not forward callback cookies. */
export async function saveOAuthState(state: string): Promise<void> {
  await oauthStateDocument(state).create({
    stateHash: oauthStateHash(state),
    createdAt: new Date().toISOString(),
  });
}

/** Atomically consume a short-lived OAuth state so callbacks cannot be replayed. */
export async function consumeOAuthState(state: string): Promise<boolean> {
  let document;
  try {
    document = oauthStateDocument(state);
  } catch {
    return false;
  }

  return getFirestoreClient().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    transaction.delete(document);
    if (!snapshot.exists) return false;

    const data = snapshot.data() as { stateHash?: unknown; createdAt?: unknown };
    const createdAt = typeof data.createdAt === 'string' ? Date.parse(data.createdAt) : Number.NaN;
    return data.stateHash === oauthStateHash(state)
      && Number.isFinite(createdAt)
      && Date.now() - createdAt <= OAUTH_STATE_MAX_AGE_MS;
  });
}

export function getGoogleOAuthClient() {
  assertExternalServicesAllowed('Google OAuth');
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildCalendarAuthUrl(state: string): string {
  return getGoogleOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: CALENDAR_SCOPES,
    state,
  });
}

function tokenDoc(userId: string, name: GoogleIntegrationName) {
  assertExternalServicesAllowed('Firestore OAuth token storage');
  return getFirestoreClient().collection('users').doc(userId).collection('googleTokens').doc(name);
}

function compactTokens(tokens: GoogleOAuthTokens): GoogleOAuthTokens {
  return Object.fromEntries(Object.entries(tokens).filter(([, value]) => value !== undefined)) as GoogleOAuthTokens;
}

export async function saveGoogleOAuthTokens(
  userId: string,
  name: GoogleIntegrationName,
  tokens: GoogleOAuthTokens
): Promise<void> {
  await tokenDoc(userId, name).set(
    {
      ...compactTokens(tokens),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function getGoogleOAuthTokens(userId: string, name: GoogleIntegrationName): Promise<GoogleOAuthTokens | null> {
  const snapshot = await tokenDoc(userId, name).get();
  return snapshot.exists ? (snapshot.data() as GoogleOAuthTokens) : null;
}

export async function deleteGoogleOAuthTokens(userId: string, name: GoogleIntegrationName): Promise<void> {
  await tokenDoc(userId, name).delete();
}

export async function hasGoogleOAuthTokens(userId: string, name: GoogleIntegrationName): Promise<boolean> {
  return Boolean(await getGoogleOAuthTokens(userId, name));
}

export async function exchangeCalendarCode(userId: string, code: string): Promise<void> {
  const client = getGoogleOAuthClient();
  const { tokens } = await client.getToken(code);
  await saveGoogleOAuthTokens(userId, 'calendar', tokens);
}

export async function getAuthorizedCalendarClient(userId: string): Promise<calendar_v3.Calendar> {
  const tokens = await getGoogleOAuthTokens(userId, 'calendar');
  if (!tokens) {
    throw new Error('Google Calendar is not connected.');
  }

  const auth = getGoogleOAuthClient();
  auth.setCredentials(tokens as Parameters<typeof auth.setCredentials>[0]);
  auth.on('tokens', async (updatedTokens) => {
    await saveGoogleOAuthTokens(userId, 'calendar', { ...tokens, ...updatedTokens });
  });

  return google.calendar({ version: 'v3', auth: auth as never });
}
