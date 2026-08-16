'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AuthUser, getFirebaseAuth, signOutFromGoogle, subscribeToAuth } from '@/lib/auth/client';
import { getRedirectResult } from 'firebase/auth';

interface AuthContextValue {
  user: AuthUser | null;
  userId: string | null;
  demoMode: boolean;
  isReady: boolean;
  error: string;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    fetch('/api/runtime')
      .then(async (response) => {
        if (!response.ok) throw new Error('Runtime configuration could not be loaded.');
        return response.json() as Promise<{ demoMode?: boolean }>;
      })
      .then((runtime) => {
        if (disposed) return;
        if (runtime.demoMode === true) {
          setDemoMode(true);
          setUser({ uid: 'demo-user', displayName: 'Local demo', email: '' });
          setIsReady(true);
          return;
        }
        const firebaseAuth = getFirebaseAuth();
        getRedirectResult(firebaseAuth).catch((caught) => {
          if (disposed) return;
          setError(caught instanceof Error ? caught.message : 'Google sign-in could not be completed.');
        });
        unsubscribe = subscribeToAuth((nextUser) => {
          if (disposed) return;
          setUser(nextUser);
          setIsReady(true);
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
    isReady,
    error,
    signOut: async () => {
      if (!demoMode) await signOutFromGoogle();
    },
  }), [demoMode, error, isReady, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
