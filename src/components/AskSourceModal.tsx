'use client';

import React, { useEffect, useRef } from 'react';
import { BookOpen, ExternalLink, Globe, X } from 'lucide-react';
import type { AskSource } from '@/types/ask';
import { humanizeSourceTitle } from '@/lib/context/sourceTitle';
import { useDismissibleModal } from '@/lib/ui/useDismissibleModal';

interface AskSourceModalProps {
  sources: AskSource[];
  onClose: () => void;
}

function sourceKindLabel(kind: AskSource['kind']): string {
  switch (kind) {
    case 'web':
      return 'Web source';
    case 'graph':
      return 'Workspace graph';
    case 'memory':
      return 'Saved memory';
    case 'calendar':
      return 'Calendar context';
    default:
      return 'Workspace context';
  }
}

function isWebSource(source: AskSource): boolean {
  return source.kind === 'web' && Boolean(source.url);
}

export const AskSourceModal: React.FC<AskSourceModalProps> = ({ sources, onClose }) => {
  const modalRef = useRef<HTMLElement>(null);

  useDismissibleModal(onClose, modalRef, true);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/75 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <section
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-source-modal-title"
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/60 sm:max-h-[min(720px,calc(100dvh-3rem))] sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">ASK GAPWISE</p>
            <h2 id="ask-source-modal-title" className="mt-1 text-lg font-bold text-slate-100">Source context</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source context"
            className="h-9 w-9 shrink-0 rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100"
          >
            <X className="mx-auto h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          {sources.map((source) => (
            <article key={source.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md border border-slate-700 bg-slate-950 p-1.5 text-cyan-300">
                  {isWebSource(source)
                    ? <Globe className="h-4 w-4" aria-hidden="true" />
                    : <BookOpen className="h-4 w-4" aria-hidden="true" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-cyan-300">{humanizeSourceTitle(source.title)}</h3>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    {sourceKindLabel(source.kind)}
                  </p>
                </div>
              </div>

              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                {source.excerpt}
              </p>

              {source.reason && (
                <div className="mt-4 border-t border-slate-800 pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Why it was used</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-400">{source.reason}</p>
                </div>
              )}

              {isWebSource(source) && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-4 inline-flex max-w-full items-center gap-1.5 break-all text-xs font-semibold text-cyan-300 underline decoration-cyan-800 underline-offset-2 hover:text-cyan-200"
                >
                  <span>{source.url}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </a>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};
