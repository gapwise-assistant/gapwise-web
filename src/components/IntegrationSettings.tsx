'use client';

import React from 'react';
import { CalendarDays, Folder, Mail, PlugZap, Unplug } from 'lucide-react';
import { GoogleIntegrationName, GoogleIntegrationState } from '@/types/google';

interface IntegrationSettingsProps {
  integration: GoogleIntegrationState;
  onConnect: (name: GoogleIntegrationName) => void;
  onDisconnect: (name: GoogleIntegrationName) => void;
  onUpdate: (integration: GoogleIntegrationState) => void;
  variant?: 'page' | 'drawer';
}

const iconByName = {
  calendar: <CalendarDays className="w-4 h-4" />,
  gmail: <Mail className="w-4 h-4" />,
  drive: <Folder className="w-4 h-4" />,
};

const labelByName = {
  calendar: 'Google Calendar',
  gmail: 'Gmail',
  drive: 'Google Drive',
};

const descriptionByName = {
  calendar: 'Upcoming commitments',
  gmail: 'Relevant messages',
  drive: 'Selected documents',
};

export const IntegrationSettings: React.FC<IntegrationSettingsProps> = ({
  integration,
  onConnect,
  onDisconnect,
  onUpdate,
  variant = 'page',
}) => {
  const isAvailable = integration.name === 'calendar';
  const isConnected = isAvailable && integration.status === 'connected';
  const statusText = isConnected ? 'Connected' : isAvailable ? 'Connect' : 'Unavailable';

  if (variant === 'drawer') {
    return (
      <article className="flex min-h-14 items-center gap-3 py-3">
        <span className="shrink-0 text-cyan-300" aria-hidden="true">{iconByName[integration.name]}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-bold text-slate-200">{labelByName[integration.name]}</h3>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">{descriptionByName[integration.name]}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`text-[10px] font-semibold ${isConnected ? 'text-emerald-300' : 'text-slate-500'}`}>{statusText}</span>
          {isConnected ? (
            <button
              type="button"
              onClick={() => onDisconnect(integration.name)}
              className="rounded-md px-1.5 py-1 text-[10px] font-semibold text-slate-500 transition-colors hover:text-rose-200"
            >
              Disconnect
            </button>
          ) : isAvailable ? (
            <button
              type="button"
              onClick={() => onConnect(integration.name)}
              className="rounded-md px-1.5 py-1 text-[10px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-950/50"
            >
              Connect
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-cyan-300">{iconByName[integration.name]}</span>
          <div>
            <h3 className="text-sm font-bold text-slate-100">{labelByName[integration.name]}</h3>
            <p className={`text-[10px] font-semibold ${isConnected ? 'text-emerald-300' : 'text-slate-500'}`}>
              {statusText}
            </p>
          </div>
        </div>
        {isConnected ? (
          <button
            type="button"
            onClick={() => onDisconnect(integration.name)}
            className="rounded-lg border border-rose-800 bg-rose-950 px-2 py-1 text-[10px] font-semibold text-rose-200 flex items-center gap-1"
          >
            <Unplug className="w-3 h-3" />
            Disconnect
          </button>
        ) : !isAvailable ? (
          <span className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-500">
            Not connected
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onConnect(integration.name)}
            className="rounded-lg border border-emerald-800 bg-emerald-950 px-2 py-1 text-[10px] font-semibold text-emerald-200 flex items-center gap-1"
          >
            <PlugZap className="w-3 h-3" />
            Connect
          </button>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-[10px] text-slate-400">
        {isAvailable ? 'Read-only calendar access.' : 'Not available in this build.'}
      </div>

      {isAvailable && integration.name === 'gmail' && (
        <label className="block text-xs text-slate-400">
          Selected labels
          <input
            value={integration.selectedLabels?.join(', ') ?? ''}
            onChange={(event) =>
              onUpdate({
                ...integration,
                selectedLabels: event.target.value
                  .split(',')
                  .map((label) => label.trim())
                  .filter(Boolean),
              })
            }
            placeholder="INBOX, Opportunities"
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none"
          />
        </label>
      )}

      {isAvailable && integration.name === 'drive' && (
        <label className="block text-xs text-slate-400">
          Selected Drive file/folder IDs
          <input
            value={integration.selectedDriveIds?.join(', ') ?? ''}
            onChange={(event) =>
              onUpdate({
                ...integration,
                selectedDriveIds: event.target.value
                  .split(',')
                  .map((id) => id.trim())
                  .filter(Boolean),
              })
            }
            placeholder="career-folder, drive_cv_1"
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none"
          />
        </label>
      )}
    </article>
  );
};
