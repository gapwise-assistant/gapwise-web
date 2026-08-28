'use client';

import React, { useEffect, useState } from 'react';
import { CalendarDays, Folder, Mail, MoreHorizontal, PlugZap, Unplug } from 'lucide-react';
import { formatDateTime } from '@/lib/datetime/displayDateTime';
import { GoogleIntegrationName, GoogleIntegrationState } from '@/types/google';

export type IntegrationOperation = {
  kind: 'connect' | 'disconnect';
  name: GoogleIntegrationName;
};

interface IntegrationSettingsProps {
  integration: GoogleIntegrationState;
  onConnect: (name: GoogleIntegrationName) => void | Promise<void>;
  onDisconnect: (name: GoogleIntegrationName) => void | Promise<void>;
  /** Kept for compatibility with the existing integration settings contract. */
  onUpdate: (integration: GoogleIntegrationState) => void | Promise<void>;
  busyOperation?: IntegrationOperation | null;
  error?: string;
  variant?: 'page' | 'drawer';
}

const iconByName = {
  calendar: <CalendarDays className="h-4 w-4" />,
  gmail: <Mail className="h-4 w-4" />,
  drive: <Folder className="h-4 w-4" />,
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

function isSupported(integration: GoogleIntegrationState): boolean {
  return integration.name === 'calendar';
}

function isOperationFor(
  operation: IntegrationOperation | null | undefined,
  name: GoogleIntegrationName,
  kind: IntegrationOperation['kind'],
): boolean {
  return operation?.name === name && operation.kind === kind;
}

function statusFor(
  integration: GoogleIntegrationState,
  operation: IntegrationOperation | null | undefined,
): { label: string; tone: string } {
  if (!isSupported(integration)) {
    return { label: 'Coming soon', tone: 'text-slate-500' };
  }
  if (isOperationFor(operation, integration.name, 'connect')) {
    return { label: 'Connecting…', tone: 'text-cyan-200' };
  }
  if (isOperationFor(operation, integration.name, 'disconnect')) {
    return { label: 'Disconnecting…', tone: 'text-amber-200' };
  }
  if (integration.status === 'token_expired' || integration.status === 'permission_denied') {
    return { label: 'Reconnect required', tone: 'text-amber-200' };
  }
  if (integration.status === 'connected') {
    return { label: 'Connected', tone: 'text-emerald-300' };
  }
  return { label: 'Not connected', tone: 'text-slate-400' };
}

export const IntegrationSettings: React.FC<IntegrationSettingsProps> = ({
  integration,
  onConnect,
  onDisconnect,
  busyOperation,
  error,
  variant = 'page',
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const supported = isSupported(integration);
  const connected = supported && integration.status === 'connected';
  const connecting = isOperationFor(busyOperation, integration.name, 'connect');
  const disconnecting = isOperationFor(busyOperation, integration.name, 'disconnect');
  const status = statusFor(integration, busyOperation);
  const actionLabel = integration.status === 'token_expired' || integration.status === 'permission_denied'
    ? 'Reconnect'
    : 'Connect';

  useEffect(() => {
    if (!menuOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest('[data-integration-menu]')) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!connected) setMenuOpen(false);
  }, [connected]);

  const compact = variant === 'drawer';

  return (
    <article className={compact
      ? 'flex min-h-16 items-center gap-3 border-b border-slate-800/80 py-3 last:border-b-0'
      : 'grid grid-cols-[auto,minmax(0,1fr),auto] gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4'}>
      <span className="shrink-0 text-cyan-300" aria-hidden="true">{iconByName[integration.name]}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className={compact ? 'truncate text-xs font-bold text-slate-200' : 'text-sm font-bold text-slate-100'}>
            {labelByName[integration.name]}
          </h3>
          <span className={`text-[10px] font-semibold ${status.tone}`}>{status.label}</span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-slate-500">{descriptionByName[integration.name]}</p>
        {supported && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
            <span>Read-only access</span>
            {integration.lastSyncAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>Last synced {formatDateTime(integration.lastSyncAt)}</span>
              </>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-1 text-[10px] text-rose-300">{error}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {connected && !disconnecting ? (
          <div className="relative" data-integration-menu>
            <button
              type="button"
              aria-label={`${labelByName[integration.name]} connection actions`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-10 z-20 min-w-36 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl shadow-black/30">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void onDisconnect(integration.name);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold text-rose-200 hover:bg-rose-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                >
                  <Unplug className="h-3.5 w-3.5" aria-hidden="true" />
                  Disconnect
                </button>
              </div>
            )}
          </div>
        ) : supported && !connecting && !disconnecting ? (
          <button
            type="button"
            onClick={() => { void onConnect(integration.name); }}
            className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${integration.status === 'token_expired' || integration.status === 'permission_denied'
              ? 'border-amber-800 bg-amber-950/40 text-amber-200 hover:border-amber-600'
              : 'border-cyan-800 bg-cyan-950/40 text-cyan-200 hover:border-cyan-600'}`}
          >
            <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />
            {actionLabel}
          </button>
        ) : null}
      </div>

      {!compact && supported && (
        <div className="col-span-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-[10px] text-slate-400">
          Read-only calendar access.
        </div>
      )}
    </article>
  );
};
