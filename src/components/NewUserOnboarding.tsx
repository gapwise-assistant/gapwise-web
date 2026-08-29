'use client';

import React from 'react';
import NextImage from 'next/image';
import { FolderPlus, LoaderCircle, PlayCircle } from 'lucide-react';

interface NewUserOnboardingProps {
  isLoadingDemo: boolean;
  error?: string;
  isPublicDemo?: boolean;
  onCreateProject: () => void;
  onLoadDemo: () => void;
}

export const NewUserOnboarding: React.FC<NewUserOnboardingProps> = ({
  isLoadingDemo,
  error,
  isPublicDemo = false,
  onCreateProject,
  onLoadDemo,
}) => (
  <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 py-12 text-slate-100">
    <section className="flex w-full max-w-[620px] flex-col items-center text-center">
      <div className="flex items-center gap-2.5">
        <NextImage
          src="/icons/g-logo.png"
          alt="Gapwise logo"
          width={1299}
          height={1211}
          priority
          className="h-14 w-14"
        />
        <span className="text-2xl font-extrabold tracking-tight text-slate-100">Gapwise</span>
      </div>
      {isPublicDemo && (
        <p className="mt-5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">Demo access</p>
      )}
      <h1 className="mt-8 text-4xl font-extrabold tracking-tight text-slate-50 sm:text-[40px]">Start your first workspace</h1>
      <p className="mt-4 max-w-[560px] text-lg leading-8 text-slate-400">
        {isPublicDemo
          ? 'Explore a prepared Gapwise workspace.'
          : 'Add your project and let Gapwise identify what needs attention, or explore a prepared example.'}
      </p>

      <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
        {!isPublicDemo && (
          <button
            type="button"
            onClick={onCreateProject}
            className="inline-flex h-12 min-w-[190px] items-center justify-center gap-2 whitespace-nowrap rounded-md border border-cyan-500 bg-cyan-500 px-5 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            <FolderPlus className="h-5 w-5" aria-hidden="true" />
            <span>+ Create workspace</span>
          </button>
        )}
        <button
          type="button"
          onClick={onLoadDemo}
          disabled={isLoadingDemo}
          className="inline-flex h-12 min-w-[190px] items-center justify-center gap-2 whitespace-nowrap rounded-md border border-slate-600 bg-transparent px-5 text-sm font-bold text-slate-200 transition hover:border-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-wait disabled:opacity-60"
        >
          {isLoadingDemo ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : <PlayCircle className="h-5 w-5" aria-hidden="true" />}
          <span>{isLoadingDemo ? 'Loading demo…' : '▶ Load demo'}</span>
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-4 max-w-[560px] rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-left text-xs leading-5 text-rose-200">
          {error}
        </p>
      )}
    </section>
  </main>
);
