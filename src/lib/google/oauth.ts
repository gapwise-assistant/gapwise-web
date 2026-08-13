import { randomBytes } from 'crypto';
import { google, calendar_v3 } from 'googleapis';
import { getFirestoreClient } from '@/lib/firebase-admin';
import { GoogleIntegrationName } from '@/types/google';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

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
