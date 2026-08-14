'use client';

import React, { useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { TraceEvent } from '@/types/observability';
import { authFetch } from '@/lib/auth/client';

interface TracePanelProps {
  userId: string;
}

export const TracePanel: React.FC<TracePanelProps> = ({ userId }) => {
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const res = await authFetch(`/api/dev/traces?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    setTraces(data.traces ?? []);
  };

  useEffect(() => {
    load();
  }, [userId]);

  return (
    <section className="fixed bottom-3 right-3 z-40">
      {open && (
        <div className="mb-2 w-[min(92vw,440px)] max-h-[420px] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-100">Developer Trace</h2>
            <button
              type="button"
              onClick={load}
              className="rounded-lg border border-slate-800 bg-slate-900 p-1.5 text-slate-400 hover:text-cyan-300"
              title="Refresh traces"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {traces.length === 0 ? (
              <p className="text-xs text-slate-500">No traces recorded yet.</p>
            ) : (
              traces.slice(0, 8).map((trace) => (
                <div key={trace.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold text-slate-200">{trace.label}</span>
                    <span className="text-cyan-300">{trace.duration_ms}ms</span>
                  </div>
                  <p className="mt-1 text-slate-500">{trace.route}</p>
                  <p className="mt-2 text-slate-400">
                    Agents: {trace.agentNames.join(', ') || 'none'}
                  </p>
                  <p className="text-slate-500">Context IDs: {trace.contextIds.length}</p>
                  {trace.scores.length > 0 && (
                    <p className="text-slate-500">Scores: {trace.scores.map((score) => `${score.id}:${score.score}`).join(', ')}</p>
                  )}
                  {trace.error && <p className="mt-1 text-rose-300">{trace.error}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-full border border-cyan-800 bg-cyan-950 p-3 text-cyan-200 shadow-xl hover:bg-cyan-900"
        title="Open developer trace panel"
      >
        <Activity className="w-5 h-5" />
      </button>
    </section>
  );
};
