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
}

export const ConnectedContext: React.FC<ConnectedContextProps> = ({
  userId,
  project,
  onImportSources,
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
    <section className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-300" />
            Connections
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {demoMode
              ? 'Local fixtures are active. No Google account or API is being contacted.'
              : 'Connect trusted accounts Gapswise can read from. Calendar uses the real OAuth connection.'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-200 hover:text-cyan-300 flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh connections
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {integrations.map((integration) => (
          <IntegrationSettings
            key={integration.name}
            integration={integration}
            onConnect={handleConnect}
            onDisconnect={(name) => mutate({ action: 'disconnect', name })}
            onUpdate={(updated) => mutate({ action: 'update', integration: updated })}
          />
        ))}
      </div>

      {message && <p className="text-xs text-emerald-300">{message}</p>}
    </section>
  );
};
