'use client';

import React, { useState } from 'react';
import { LogIn, Target } from 'lucide-react';
import { signInWithGoogle } from '@/lib/auth/client';

interface LoginScreenProps {
  error?: string;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ error: initialError }) => {
  const [error, setError] = useState(initialError ?? '');
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setError('');
    try {
      await signInWithGoogle();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Google sign-in could not be completed.');
      setIsSigningIn(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-300">
          <Target className="h-6 w-6" />
        </div>
        <p className="mt-5 text-xs font-extrabold uppercase tracking-[0.2em] text-cyan-400">GAPSWISE</p>
        <h1 className="mt-2 text-2xl font-extrabold">Your context, connected.</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Sign in to load your projects, memories, documents, and priorities.
        </p>
        <button
          type="button"
          onClick={() => void handleSignIn()}
          disabled={isSigningIn}
          className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-200 disabled:cursor-wait disabled:opacity-60"
        >
          <LogIn className="h-4 w-4" />
          {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
        </button>
        {error && <p className="mt-4 text-left text-xs leading-5 text-rose-300">{error}</p>}
      </section>
    </main>
  );
};
