'use client';

import React from 'react';
import NextImage from 'next/image';
import { FolderPlus, LoaderCircle, PlayCircle, X } from 'lucide-react';

interface NewUserOnboardingProps {
  isLoadingDemo: boolean;
  error?: string;
  isPublicDemo?: boolean;
  onCreateProject: () => void;
  onLoadDemo: () => void;
  onLoadSoftwareDemo?: () => void;
}

export const NewUserOnboarding: React.FC<NewUserOnboardingProps> = ({
  isLoadingDemo,
  error,
  isPublicDemo = false,
  onCreateProject,
  onLoadDemo,
  onLoadSoftwareDemo,
}) => {
  const [demoChooserOpen, setDemoChooserOpen] = React.useState(false);
  const handleLoadDemo = () => {
    if (!isPublicDemo && onLoadSoftwareDemo) {
      setDemoChooserOpen(true);
      return;
    }
    onLoadDemo();
  };

  return (
    <>
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
              onClick={handleLoadDemo}
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

      {demoChooserOpen && onLoadSoftwareDemo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDemoChooserOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="prepared-demo-title"
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl shadow-slate-950/80"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="prepared-demo-title" className="text-base font-bold text-slate-100">Choose a prepared example</h2>
                <p className="mt-1 text-xs leading-5 text-slate-400">Both examples are written to your workspaces without changing existing ones.</p>
              </div>
              <button
                type="button"
                aria-label="Close prepared example chooser"
                onClick={() => setDemoChooserOpen(false)}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={() => {
                  setDemoChooserOpen(false);
                  onLoadDemo();
                }}
                className="rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-left hover:border-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <span className="block text-sm font-bold text-slate-100">Quick project demo</span>
                <span className="mt-1 block text-xs text-slate-400">A short prepared example.</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDemoChooserOpen(false);
                  onLoadSoftwareDemo();
                }}
                className="rounded-xl border border-cyan-800/80 bg-cyan-950/20 px-4 py-3 text-left hover:border-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <span className="block text-sm font-bold text-cyan-100">Software release demo</span>
                <span className="mt-1 block text-xs text-slate-400">A detailed release project with code, failures, decisions, Ask, and History.</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
};
