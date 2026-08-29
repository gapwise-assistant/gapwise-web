'use client';

import React from 'react';
import NextImage from 'next/image';

/** Presentation for the existing initial workspace loading gate. */
export const WorkspaceLoadingState: React.FC = () => (
  <div className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-6 text-slate-100">
    <div
      className="flex flex-col items-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span
          className="workspace-loading-glow absolute inset-[-1.25rem] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.34),rgba(37,99,235,0.18)_42%,transparent_72%)] blur-xl"
          aria-hidden="true"
        />
        <NextImage
          src="/icons/g-logo.png"
          alt=""
          width={80}
          height={80}
          priority
          className="relative h-20 w-20 object-contain"
        />
      </div>
      <p className="mt-6 text-center text-base font-medium text-slate-400 sm:text-lg">
        Loading your workspace…
      </p>
    </div>
  </div>
);
