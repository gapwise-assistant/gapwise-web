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
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getStorageProvider } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { appendCalendarSyncStep, finishCalendarSyncTrace, startCalendarSyncTrace } from '@/lib/observability/trace';
import { semanticProjectVersion } from '@/lib/projects/semanticVersion';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  let userId: string;
  try {
    userId = await requireAuthenticatedUserId(request, url.searchParams.get('userId')?.trim());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }
  const integrations = await getIntegrationStates(userId);
  const calendar = integrations.find((integration) => integration.name === 'calendar');
  if (isDemoMode()) {
    if (calendar?.status !== 'connected') {
      const connectedState = {
        ...createDemoConnectedState('calendar'),
        ...(calendar?.lastSyncAt ? { lastSyncAt: calendar.lastSyncAt } : {}),
      };
      return NextResponse.json({
        integrations: await updateIntegrationState(userId, connectedState),
        demoMode: true,
      });
    }
    return NextResponse.json({ integrations, demoMode: true });
  }
  if (calendar?.status !== 'connected' && await hasGoogleOAuthTokens(userId, 'calendar')) {
    const connectedState = {
      ...createDemoConnectedState('calendar'),
      ...(calendar?.lastSyncAt ? { lastSyncAt: calendar.lastSyncAt } : {}),
    };
    return NextResponse.json({ integrations: await updateIntegrationState(userId, connectedState) });
  }
  return NextResponse.json({ integrations });
}

export async function POST(request: Request) {
  let requestedAction: string | undefined;
  let calendarSyncRunId: string | undefined;
  try {
    const body = (await request.json()) as {
      userId?: string;
      action?: 'connect' | 'disconnect' | 'sync' | 'update';
      name?: GoogleIntegrationName;
      query?: string;
      projectId?: string;
      integration?: GoogleIntegrationState;
      selectedLabels?: string[];
      selectedDriveIds?: string[];
    };
    requestedAction = body.action;
    const userId = await requireAuthenticatedUserId(request, body.userId?.trim());
    if (body.action === 'sync') {
      calendarSyncRunId = startCalendarSyncTrace(userId, body.projectId?.trim() || null);
    }

    if (isDemoMode() && body.action === 'connect') {
      if (!body.name) throw new Error('Missing integration name.');
      const integrations = body.name === 'calendar'
        ? await updateIntegrationState(userId, createDemoConnectedState('calendar'))
        : await getIntegrationStates(userId);
      return NextResponse.json({ integrations, demoMode: true });
    }

    if (body.action === 'sync') {
      const projectId = body.projectId?.trim();
      if (!projectId || projectId === '__everything__' || projectId === '__general_context__') {
        throw new StorageError('Select a workspace before syncing connected sources.', 'VALIDATION_ERROR');
      }
      const storage = getStorageProvider();
      const project = await storage.getProject(userId, projectId);
      if (!project) {
        throw new StorageError('The selected workspace could not be found.', 'NOT_FOUND');
      }
      if (project.status === 'archived') {
        throw new StorageError('Select an active workspace before syncing connected sources.', 'VALIDATION_ERROR');
      }
      const integrations = await getIntegrationStates(userId);
      const connectedCalendar = integrations.find((integration) => integration.name === 'calendar');
      if (calendarSyncRunId) {
        appendCalendarSyncStep(calendarSyncRunId, {
          name: 'Sync request and scope',
          status: 'completed',
          startedAt: new Date().toISOString(),
          durationMs: 0,
          details: {
            requestedProjectId: projectId,
            loadedProjectId: project.id,
            projectSemanticVersion: semanticProjectVersion(project),
            projectStatus: project.status,
            calendarConnected: connectedCalendar?.status === 'connected',
            calendarStatus: connectedCalendar?.status ?? 'disconnected',
            lastSyncAtBeforeSync: connectedCalendar?.lastSyncAt ?? null,
          },
        });
      }
      const signals = await collectWorkspaceSignalsForUser({
        userId,
        integrations,
        query: body.query ?? '',
        project,
        storage,
        now: new Date(),
        forceCalendarRefresh: true,
        calendarSyncRunId,
      });
      const calendar = integrations.find((integration) => integration.name === 'calendar');
      const refreshedIntegrations = calendar?.status === 'connected'
        ? await updateIntegrationState(userId, { ...calendar, lastSyncAt: new Date().toISOString() })
        : integrations;
      if (calendarSyncRunId) {
        appendCalendarSyncStep(calendarSyncRunId, {
          name: 'Sync response construction',
          status: 'completed',
          startedAt: new Date().toISOString(),
          durationMs: 0,
          details: {
            projectId: project.id,
            calendarEventIds: signals.calendarEvents.map((event) => event.id),
            calendarSourceIds: signals.derivedSources
              .filter((source) => source.mime_type === 'application/vnd.google.calendar.event')
              .map((source) => source.id),
            calendarEventCount: signals.calendarEvents.length,
            calendarSourceCount: signals.derivedSources.filter((source) => source.mime_type === 'application/vnd.google.calendar.event').length,
            gmailCount: signals.gmailMessages.length,
            driveCount: signals.driveFiles.length,
            lastSyncAtUpdated: refreshedIntegrations.some((integration) => integration.name === 'calendar' && integration.lastSyncAt !== undefined),
            httpStatus: 200,
          },
        });
        finishCalendarSyncTrace(calendarSyncRunId, 'completed');
      }
      return NextResponse.json({ signals, integrations: refreshedIntegrations, calendarSyncRunId });
    }

    if (body.action === 'update' && body.integration) {
      return NextResponse.json({ integrations: await updateIntegrationState(userId, body.integration) });
    }

    if (!body.name) throw new Error('Missing integration name.');

    if (body.action === 'disconnect') {
      if (body.name === 'calendar' && !isDemoMode()) {
        await deleteGoogleOAuthTokens(userId, 'calendar');
      }
      return NextResponse.json({ integrations: await disconnectIntegrationForUser(userId, body.name) });
    }

    const integrations = await connectIntegration(userId, body.name, {
      selectedLabels: body.selectedLabels,
      selectedDriveIds: body.selectedDriveIds,
    });
    return NextResponse.json({ integrations });
  } catch (error) {
    if (calendarSyncRunId) {
      finishCalendarSyncTrace(
        calendarSyncRunId,
        'failed',
        error instanceof Error ? error.message : 'Google integration request failed.',
      );
    }
    const status = error instanceof StorageError
      ? error.code === 'NOT_FOUND' ? 404 : error.code === 'PERMISSION_DENIED' ? 403 : 400
      : requestedAction === 'sync' ? 503 : 400;
    const expectedClientError = error instanceof StorageError
      && ['NOT_FOUND', 'PERMISSION_DENIED', 'VALIDATION_ERROR'].includes(error.code);
    const message = requestedAction === 'sync' && !expectedClientError
      ? 'Connected context could not be refreshed. Try again.'
      : error instanceof Error ? error.message : 'Google integration request failed.';
    return NextResponse.json({ error: message, ...(calendarSyncRunId ? { calendarSyncRunId } : {}) }, { status });
  }
}
