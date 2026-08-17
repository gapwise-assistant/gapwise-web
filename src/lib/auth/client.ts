'use client';

import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';

export interface ClientAuthConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface AuthUser {
  uid: string;
  displayName: string;
  email: string;
  photoUrl?: string;
}

function configFromEnvironment(): ClientAuthConfig | null {
  const values = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  if (Object.values(values).some((value) => !value?.trim())) return null;
  return values as ClientAuthConfig;
}

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (firebaseAuth) return firebaseAuth;
  const config = configFromEnvironment();
  if (!config) {
    throw new Error('Firebase Authentication is not configured. Add the NEXT_PUBLIC_FIREBASE_* values to .env.local.');
  }
  firebaseApp = getApps()[0] ?? initializeApp(config);
  firebaseAuth = getAuth(firebaseApp);
  return firebaseAuth;
}

export function subscribeToAuth(callback: (user: AuthUser | null) => void): () => void {
  return onAuthStateChanged(getFirebaseAuth(), (user) => callback(user ? toAuthUser(user) : null));
}

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(getFirebaseAuth(), provider);
}

export async function signOutFromGoogle(): Promise<void> {
  await firebaseSignOut(getFirebaseAuth());
}

export async function getCurrentIdToken(): Promise<string | null> {
  try {
    const user = getFirebaseAuth().currentUser;
    return user ? user.getIdToken() : null;
  } catch {
    // Demo mode intentionally has no Firebase web configuration.
    return null;
  }
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getCurrentIdToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    displayName: user.displayName ?? user.email ?? 'Gapwise user',
    email: user.email ?? '',
    photoUrl: user.photoURL ?? undefined,
  };
}
