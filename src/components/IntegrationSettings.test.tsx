import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { IntegrationSettings } from '@/components/IntegrationSettings';
import { createDisconnectedState, createDemoConnectedState } from '@/lib/google/auth';

const noop = vi.fn();

describe('IntegrationSettings', () => {
  it('shows one Connect action and a distinct Not connected status', () => {
    const html = renderToStaticMarkup(
      <IntegrationSettings
        integration={createDisconnectedState('calendar')}
        onConnect={noop}
        onDisconnect={noop}
        onUpdate={noop}
        variant="drawer"
      />,
    );

    expect(html).toContain('Not connected');
    expect(html.match(/>Connect</g)).toHaveLength(1);
    expect(html).not.toContain('>Disconnect<');
  });

  it('shows Connected and an overflow action for connected Calendar', () => {
    const html = renderToStaticMarkup(
      <IntegrationSettings
        integration={{ ...createDemoConnectedState('calendar'), lastSyncAt: '2026-08-28T12:00:00.000Z' }}
        onConnect={noop}
        onDisconnect={noop}
        onUpdate={noop}
        variant="drawer"
      />,
    );

    expect(html).toContain('Connected');
    expect(html).toContain('Last synced');
    expect(html).toContain('Read-only access');
    expect(html).toContain('Google Calendar connection actions');
    expect(html).not.toContain('>Connect<');
  });

  it('renders transient connection statuses without a duplicate action label', () => {
    const connecting = renderToStaticMarkup(
      <IntegrationSettings
        integration={createDisconnectedState('calendar')}
        onConnect={noop}
        onDisconnect={noop}
        onUpdate={noop}
        busyOperation={{ kind: 'connect', name: 'calendar' }}
        variant="drawer"
      />,
    );
    const disconnecting = renderToStaticMarkup(
      <IntegrationSettings
        integration={createDemoConnectedState('calendar')}
        onConnect={noop}
        onDisconnect={noop}
        onUpdate={noop}
        busyOperation={{ kind: 'disconnect', name: 'calendar' }}
        variant="drawer"
      />,
    );

    expect(connecting).toContain('Connecting…');
    expect(connecting).not.toContain('>Connect<');
    expect(disconnecting).toContain('Disconnecting…');
    expect(disconnecting).not.toContain('>Disconnect<');
  });

  it('shows reconnect required for expired access', () => {
    const html = renderToStaticMarkup(
      <IntegrationSettings
        integration={{ ...createDisconnectedState('calendar'), status: 'token_expired' }}
        onConnect={noop}
        onDisconnect={noop}
        onUpdate={noop}
        variant="drawer"
      />,
    );

    expect(html).toContain('Reconnect required');
    expect(html).toContain('>Reconnect<');
    expect(html).not.toContain('>Connect<');
  });

  it('keeps Gmail and Drive in Coming soon state without controls', () => {
    for (const name of ['gmail', 'drive'] as const) {
      const html = renderToStaticMarkup(
        <IntegrationSettings
          integration={createDisconnectedState(name)}
          onConnect={noop}
          onDisconnect={noop}
          onUpdate={noop}
          variant="drawer"
        />,
      );

      expect(html).toContain('Coming soon');
      expect(html).not.toContain('>Connect<');
      expect(html).not.toContain('>Reconnect<');
      expect(html).not.toContain('>Disconnect<');
    }
  });
});
