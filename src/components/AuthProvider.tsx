'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AuthUser, authFetch, getFirebaseAuth, signOutFromGoogle, subscribeToAuth } from '@/lib/auth/client';
import type { AccessTier } from '@/lib/auth/server';
import { getRedirectResult } from 'firebase/auth';

interface AuthContextValue {
  user: AuthUser | null;
  userId: string | null;
  demoMode: boolean;
  localAuth: boolean;
  accessTier: AccessTier | null;
  publicDemoMessagesRemaining: number | null;
  isReady: boolean;
  error: string;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [localAuth, setLocalAuth] = useState(false);
  const [accessTier, setAccessTier] = useState<AccessTier | null>(null);
  const [publicDemoMessagesRemaining, setPublicDemoMessagesRemaining] = useState<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    fetch('/api/runtime')
      .then(async (response) => {
        if (!response.ok) throw new Error('Runtime configuration could not be loaded.');
        return response.json() as Promise<{ demoMode?: boolean; localAuth?: boolean }>;
      })
      .then((runtime) => {
        if (disposed) return;
        if (runtime.demoMode === true || runtime.localAuth === true) {
          setDemoMode(runtime.demoMode === true);
          setLocalAuth(runtime.localAuth === true);
          setAccessTier('local_development');
          setPublicDemoMessagesRemaining(null);
          setUser({ uid: 'demo-user', displayName: runtime.localAuth ? 'Local development user' : 'Local demo', email: '', isAnonymous: false });
          setIsReady(true);
          return;
        }
        const firebaseAuth = getFirebaseAuth();
        // Finish the redirect callback before subscribing to auth state. The
        // callback can restore a user asynchronously; subscribing first can
        // briefly publish `null`, render the login screen, and restart the
        // redirect flow in browsers with strict storage isolation.
        void getRedirectResult(firebaseAuth)
          .catch((caught) => {
            if (disposed) return;
            setError(caught instanceof Error ? caught.message : 'Google sign-in could not be completed.');
          })
          .finally(() => {
            if (disposed) return;
            unsubscribe = subscribeToAuth((nextUser) => {
              if (disposed) return;
              setUser(nextUser);
              if (!nextUser) {
                setAccessTier(null);
                setPublicDemoMessagesRemaining(null);
                setIsReady(true);
                return;
              }
              setIsReady(false);
              void authFetch('/api/auth/access')
                .then(async (response) => {
                  if (!response.ok) throw new Error('Access configuration could not be loaded.');
                  return response.json() as Promise<{ accessTier?: AccessTier; publicDemoMessagesRemaining?: number | null }>;
                })
                .then((access) => {
                  if (disposed) return;
                  const tier = access.accessTier ?? (nextUser.isAnonymous ? 'public_demo' : 'public_demo');
                  setAccessTier(tier);
                  setPublicDemoMessagesRemaining(typeof access.publicDemoMessagesRemaining === 'number' ? access.publicDemoMessagesRemaining : null);
                  setIsReady(true);
                })
                .catch(() => {
                  if (disposed) return;
                  // Fail closed in the UI; server routes remain authoritative.
                  setAccessTier(nextUser.isAnonymous ? 'public_demo' : 'public_demo');
                  setPublicDemoMessagesRemaining(3);
                  setIsReady(true);
                });
            });
          });
      })
      .catch((caught) => {
        if (disposed) return;
        setError(caught instanceof Error ? caught.message : 'Authentication could not be initialized.');
        setIsReady(true);
      });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    userId: user?.uid ?? null,
    demoMode,
    localAuth,
    accessTier,
    publicDemoMessagesRemaining,
    isReady,
    error,
    signOut: async () => {
      if (!demoMode && !localAuth) await signOutFromGoogle();
    },
  }), [accessTier, demoMode, error, isReady, localAuth, publicDemoMessagesRemaining, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
