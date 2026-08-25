'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { Project } from '@/types/clarity';
import { GoogleIntegrationName, GoogleIntegrationState, GoogleWorkspaceSignals } from '@/types/google';
import { IntegrationSettings } from '@/components/IntegrationSettings';
import { authFetch } from '@/lib/auth/client';

interface ConnectedContextProps {
  userId: string;
  project: Project;
  onImportSources: (signals: GoogleWorkspaceSignals) => void;
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

  const loadIntegrations = async () => {
    const res = await authFetch(`/api/integrations/google?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    setIntegrations(data.integrations ?? []);
    setDemoMode(data.demoMode === true);
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
    if (data.integrations) setIntegrations(data.integrations);
    if (data.error) setMessage(data.error);
    return data;
  };

  const handleConnect = async (name: GoogleIntegrationName) => {
    if (name === 'calendar') {
      if (demoMode) {
        void mutate({ action: 'connect', name }).then(() => setMessage('Using local demo Calendar events.'));
        return;
      }
      const response = await authFetch('/api/integrations/google/calendar/start', {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || typeof data.url !== 'string') {
        setMessage(data.error ?? 'Google Calendar connection could not be started.');
        return;
      }
      window.location.href = data.url;
      return;
    }

    setMessage(`${name === 'gmail' ? 'Gmail' : 'Google Drive'} is not connected yet.`);
  };

  const handleSync = async () => {
    const data = await mutate({
      action: 'sync',
      query: `${project.goal} recruiter meeting demo CV`,
    });
    if (data.signals) {
      onImportSources(data.signals as GoogleWorkspaceSignals);
      setMessage(`Added ${data.signals.derivedSources.length} items from connected accounts.`);
    }
  };

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

      <div className={variant === 'drawer' ? 'divide-y divide-slate-800/80' : 'grid grid-cols-1 gap-3 lg:grid-cols-3'}>
        {integrations.map((integration) => (
          <IntegrationSettings
            key={integration.name}
            integration={integration}
            onConnect={handleConnect}
            onDisconnect={(name) => mutate({ action: 'disconnect', name })}
            onUpdate={(updated) => mutate({ action: 'update', integration: updated })}
            variant={variant}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={handleSync}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition-colors hover:border-cyan-700 hover:text-cyan-200"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh connections
      </button>

      {message && <p className="text-xs text-emerald-300">{message}</p>}
    </div>
  );
};
