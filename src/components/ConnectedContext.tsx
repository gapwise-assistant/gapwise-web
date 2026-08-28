'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { Project } from '@/types/clarity';
import { GoogleIntegrationName, GoogleIntegrationState, GoogleWorkspaceSignals } from '@/types/google';
import { IntegrationOperation, IntegrationSettings } from '@/components/IntegrationSettings';
import { authFetch } from '@/lib/auth/client';

interface ConnectedContextProps {
  userId: string;
  project: Project;
  onImportSources: (signals: GoogleWorkspaceSignals) => Promise<{ imported: number; skipped: number }>;
  variant?: 'page' | 'drawer';
}

export const ConnectedContext: React.FC<ConnectedContextProps> = ({
  userId,
  project,
  onImportSources,
  variant = 'page',
}) => {
  const [integrations, setIntegrations] = useState<GoogleIntegrationState[]>([]);
  const [message, setMessage] = useState('');
  const [demoMode, setDemoMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState('');
  const [operation, setOperation] = useState<IntegrationOperation | null>(null);
  const [itemErrors, setItemErrors] = useState<Partial<Record<GoogleIntegrationName, string>>>({});

  const loadIntegrations = async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await authFetch(`/api/integrations/google?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Connections could not be loaded.');
      setIntegrations(data.integrations ?? []);
      setDemoMode(data.demoMode === true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Connections could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadIntegrations();
  }, [userId]);

  const mutate = async (body: Record<string, unknown>) => {
    const res = await authFetch('/api/integrations/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'The connection could not be updated.');
    if (data.integrations) setIntegrations(data.integrations);
    if (data.error) setMessage(data.error);
    return data;
  };

  const handleConnect = async (name: GoogleIntegrationName) => {
    if (name !== 'calendar') return;
    setItemErrors((current) => ({ ...current, [name]: undefined }));
    setOperation({ kind: 'connect', name });
    if (name === 'calendar') {
      if (demoMode) {
        try {
          await mutate({ action: 'connect', name });
          setMessage('Using local demo Calendar events.');
        } catch (reason) {
          setItemErrors((current) => ({
            ...current,
            [name]: reason instanceof Error ? reason.message : 'Google Calendar could not be connected.',
          }));
        } finally {
          setOperation(null);
        }
        return;
      }
      try {
        const response = await authFetch('/api/integrations/google/calendar/start', {
          headers: { Accept: 'application/json' },
        });
        const data = await response.json();
        if (!response.ok || typeof data.url !== 'string') {
          throw new Error(data.error ?? 'Google Calendar connection could not be started.');
        }
        window.location.href = data.url;
      } catch (reason) {
        setItemErrors((current) => ({
          ...current,
          [name]: reason instanceof Error ? reason.message : 'Google Calendar could not be connected.',
        }));
        setOperation(null);
      }
      return;
    }
  };

  const handleDisconnect = async (name: GoogleIntegrationName) => {
    setItemErrors((current) => ({ ...current, [name]: undefined }));
    setOperation({ kind: 'disconnect', name });
    try {
      await mutate({ action: 'disconnect', name });
      setMessage('Google Calendar disconnected.');
    } catch (reason) {
      setItemErrors((current) => ({
        ...current,
        [name]: reason instanceof Error ? reason.message : 'Google Calendar could not be disconnected.',
      }));
    } finally {
      setOperation(null);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setMessage('');
    setError('');
    try {
      const semanticQuery = [
        project.title,
        project.goal,
        ...project.nodes
          .filter((node) => node.status === 'OPEN')
          .sort((left, right) => right.impact - left.impact)
          .slice(0, 5)
          .map((node) => node.text),
      ].filter(Boolean).join(' ');
      const data = await mutate({ action: 'sync', query: semanticQuery });
      if (data.signals) {
        const result = await onImportSources(data.signals as GoogleWorkspaceSignals);
        setMessage(result.imported > 0
          ? `Added ${result.imported} item${result.imported === 1 ? '' : 's'} to project context${result.skipped ? `; ${result.skipped} already existed` : ''}.`
          : 'Connected context is already up to date.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Connected context could not be refreshed.');
    } finally {
      setIsSyncing(false);
    }
  };

  const hasSupportedConnection = integrations.some(
    (integration) => integration.name === 'calendar' && integration.status === 'connected',
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            Connections
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {demoMode
              ? 'Local fixtures are active. No Google account or API is being contacted.'
              : 'Connect trusted accounts Gapwise can read from. Calendar uses the real OAuth connection.'}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div aria-label="Loading connections" className="space-y-2">
          {[0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-lg bg-slate-900" />)}
        </div>
      ) : <div className={variant === 'drawer' ? 'divide-y divide-slate-800/80' : 'grid grid-cols-1 gap-3 lg:grid-cols-3'}>
        {integrations.map((integration) => (
          <IntegrationSettings
            key={integration.name}
            integration={integration}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onUpdate={async (updated) => { await mutate({ action: 'update', integration: updated }); }}
            busyOperation={operation}
            error={itemErrors[integration.name]}
            variant={variant}
          />
        ))}
      </div>}

      {!isLoading && hasSupportedConnection && (
        <button
          type="button"
          onClick={() => { void handleSync(); }}
          disabled={isSyncing}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-800 bg-cyan-950/30 px-2.5 py-1.5 text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-600 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing connected sources…' : 'Sync connected sources'}
        </button>
      )}

      {message && <p className="text-xs text-emerald-300">{message}</p>}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    </div>
  );
};
