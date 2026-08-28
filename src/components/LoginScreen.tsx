'use client';

import React, { useState } from 'react';
import NextImage from 'next/image';
import { LogIn } from 'lucide-react';
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
        <div className="mx-auto w-44 rounded-2xl bg-white px-4 py-3 shadow-xl shadow-blue-950/20">
          <NextImage
            src="/logo.png"
            alt="Gapwise"
            width={1672}
            height={941}
            priority
            className="h-auto w-full"
          />
        </div>
        <h1 className="mt-5 text-2xl font-extrabold">Your context, connected.</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Sign in to load your workspaces, memories, documents, and priorities.
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
