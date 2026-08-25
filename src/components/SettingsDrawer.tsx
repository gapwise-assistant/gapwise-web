'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { SettingsContent, SettingsContentProps } from '@/components/SettingsContent';

interface SettingsDrawerProps extends SettingsContentProps {
  onClose: () => void;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ onClose, ...contentProps }) => {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => setEntered(true));

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-[70] flex justify-end bg-slate-950/65 transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <aside
        id="settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-drawer-title"
        className={`flex h-full w-full max-w-[480px] flex-col border-l border-slate-800 bg-slate-950 shadow-2xl shadow-black/50 transition-transform duration-200 ease-out ${entered ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/95 px-5 py-4 backdrop-blur sm:px-6">
          <div>
            <h1 id="settings-drawer-title" className="text-lg font-extrabold text-slate-100">Settings</h1>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">Manage your account and what Gapwise remembers.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            autoFocus
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 text-slate-400 transition-colors hover:border-cyan-700 hover:text-cyan-300"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SettingsContent {...contentProps} />
        </div>
      </aside>
    </div>
  );
};
