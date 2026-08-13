import { NextResponse } from 'next/server';
import { GoogleIntegrationName, GoogleIntegrationState } from '@/types/google';
import { createDemoConnectedState } from '@/lib/google/auth';
import { deleteGoogleOAuthTokens, hasGoogleOAuthTokens } from '@/lib/google/oauth';
import { collectWorkspaceSignalsForUser } from '@/lib/google/workspace';
import {
  connectIntegration,
  disconnectIntegrationForUser,
  getIntegrationStates,
  updateIntegrationState,
} from '@/lib/google/state';
import { isDemoMode } from '@/lib/runtime/demoMode';

export const runtime = 'nodejs';

function parseUserId(body: { userId?: string }) {
  const userId = body.userId?.trim();
  if (!userId) throw new Error('Missing userId.');
  return userId;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId')?.trim();
  if (!userId) return NextResponse.json({ error: 'Missing userId.' }, { status: 400 });
  if (isDemoMode()) {
    updateIntegrationState(userId, createDemoConnectedState('calendar'));
    return NextResponse.json({ integrations: getIntegrationStates(userId), demoMode: true });
  }
  if (await hasGoogleOAuthTokens(userId, 'calendar')) {
    updateIntegrationState(userId, createDemoConnectedState('calendar'));
  }
  return NextResponse.json({ integrations: getIntegrationStates(userId) });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      userId?: string;
      action?: 'connect' | 'disconnect' | 'sync' | 'update';
      name?: GoogleIntegrationName;
      query?: string;
      integration?: GoogleIntegrationState;
      selectedLabels?: string[];
      selectedDriveIds?: string[];
    };
    const userId = parseUserId(body);

    if (isDemoMode() && body.action === 'connect') {
      if (!body.name) throw new Error('Missing integration name.');
      const integrations = body.name === 'calendar'
        ? updateIntegrationState(userId, createDemoConnectedState('calendar'))
        : getIntegrationStates(userId);
      return NextResponse.json({ integrations, demoMode: true });
    }

    if (body.action === 'sync') {
      const signals = await collectWorkspaceSignalsForUser({
        userId,
        integrations: getIntegrationStates(userId),
        query: body.query ?? '',
      });
      return NextResponse.json({ signals, integrations: getIntegrationStates(userId) });
    }

    if (body.action === 'update' && body.integration) {
      return NextResponse.json({ integrations: updateIntegrationState(userId, body.integration) });
    }

    if (!body.name) throw new Error('Missing integration name.');

    if (body.action === 'disconnect') {
      if (body.name === 'calendar' && !isDemoMode()) {
        await deleteGoogleOAuthTokens(userId, 'calendar');
      }
      return NextResponse.json({ integrations: disconnectIntegrationForUser(userId, body.name) });
    }

    const integrations = connectIntegration(userId, body.name, {
      selectedLabels: body.selectedLabels,
      selectedDriveIds: body.selectedDriveIds,
    });
    return NextResponse.json({ integrations });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Google integration request failed.' }, { status: 400 });
  }
}
