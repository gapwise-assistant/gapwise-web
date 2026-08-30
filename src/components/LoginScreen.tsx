'use client';

import React, { useState } from 'react';
import NextImage from 'next/image';
import { LogIn } from 'lucide-react';
import { signInAsGuest, signInWithCredentials, signInWithGoogle } from '@/lib/auth/client';

interface LoginScreenProps {
  error?: string;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ error: initialError }) => {
  const [error, setError] = useState(initialError ?? '');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningInWithCredentials, setIsSigningInWithCredentials] = useState(false);
  const [isTryingDemo, setIsTryingDemo] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const isBusy = isSigningIn || isSigningInWithCredentials || isTryingDemo;

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

  const handleCredentialsSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSigningInWithCredentials(true);
    setError('');
    try {
      await signInWithCredentials(email, password);
    } catch {
      setError('The email or password is incorrect.');
      setIsSigningInWithCredentials(false);
    }
  };

  const handleTryDemo = async () => {
    setIsTryingDemo(true);
    setError('');
    try {
      await signInAsGuest();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The demo could not be opened.');
      setIsTryingDemo(false);
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
          disabled={isBusy}
          className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-200 disabled:cursor-wait disabled:opacity-60"
        >
          <LogIn className="h-4 w-4" />
          {isSigningIn ? 'Signing in...' : 'Continue with Google'}
        </button>
        <div className="my-5 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-slate-800" />
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">or</span>
          <span className="h-px flex-1 bg-slate-800" />
        </div>
        <form className="space-y-3 text-left" onSubmit={(event) => void handleCredentialsSignIn(event)}>
          <div>
            <label htmlFor="judge-email" className="text-xs font-semibold text-slate-300">Email</label>
            <input
              id="judge-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isBusy}
              className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:opacity-60"
              placeholder="name@example.com"
            />
          </div>
          <div>
            <label htmlFor="judge-password" className="text-xs font-semibold text-slate-300">Password</label>
            <input
              id="judge-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isBusy}
              className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:opacity-60"
              placeholder="Password"
            />
          </div>
          <button
            type="submit"
            disabled={isBusy || !email.trim() || !password}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-bold text-slate-100 transition hover:border-cyan-700 hover:bg-slate-800/80 disabled:cursor-wait disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" />
            {isSigningInWithCredentials ? 'Signing in...' : 'Continue with email'}
          </button>
        </form>
        <button
          type="button"
          onClick={() => void handleTryDemo()}
          disabled={isBusy}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-transparent px-4 py-3 text-sm font-bold text-slate-200 transition hover:border-cyan-700 hover:text-cyan-200 disabled:cursor-wait disabled:opacity-60"
        >
          {isTryingDemo ? 'Opening demo...' : 'Try demo as guest'}
        </button>
        {error && <p className="mt-4 text-left text-xs leading-5 text-rose-300">{error}</p>}
      </section>
    </main>
  );
};
