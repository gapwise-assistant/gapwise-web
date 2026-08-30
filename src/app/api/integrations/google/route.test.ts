import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import { createDemoConnectedState } from '@/lib/google/auth';
import { createProjectFromInput } from '@/lib/projects/createProject';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUserId: vi.fn(),
  getStorageProvider: vi.fn(),
  getIntegrationStates: vi.fn(),
  updateIntegrationState: vi.fn(),
  collectWorkspaceSignalsForUser: vi.fn(),
  hasGoogleOAuthTokens: vi.fn(),
  deleteGoogleOAuthTokens: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  requireAuthenticatedUserId: mocks.requireAuthenticatedUserId,
}));
vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return { ...actual, getStorageProvider: mocks.getStorageProvider };
});
vi.mock('@/lib/google/state', () => ({
  getIntegrationStates: mocks.getIntegrationStates,
  updateIntegrationState: mocks.updateIntegrationState,
  connectIntegration: vi.fn(),
  disconnectIntegrationForUser: vi.fn(),
}));
vi.mock('@/lib/google/workspace', () => ({
  collectWorkspaceSignalsForUser: mocks.collectWorkspaceSignalsForUser,
}));
vi.mock('@/lib/google/oauth', () => ({
  hasGoogleOAuthTokens: mocks.hasGoogleOAuthTokens,
  deleteGoogleOAuthTokens: mocks.deleteGoogleOAuthTokens,
}));

function request(body: unknown): Request {
  return new Request('http://localhost/api/integrations/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/integrations/google sync scope', () => {
  beforeEach(() => {
    vi.stubEnv('GAPSWISE_DEMO_MODE', 'false');
    vi.clearAllMocks();
    mocks.requireAuthenticatedUserId.mockResolvedValue('calendar-user');
    mocks.getIntegrationStates.mockResolvedValue([createDemoConnectedState('calendar')]);
    mocks.updateIntegrationState.mockImplementation(async (_userId: string, state: unknown) => [state]);
    mocks.collectWorkspaceSignalsForUser.mockResolvedValue({
      calendarEvents: [], gmailMessages: [], driveFiles: [], derivedSources: [],
    });
  });

  it('requires one explicit real project and never falls back to an aggregate scope', async () => {
    const getProject = vi.fn();
    mocks.getStorageProvider.mockReturnValue({ getProject });

    const response = await POST(request({ action: 'sync', userId: 'calendar-user' }));

    expect(response.status).toBe(400);
    expect(getProject).not.toHaveBeenCalled();
    expect(mocks.collectWorkspaceSignalsForUser).not.toHaveBeenCalled();
  });

  it('loads the requested project before refreshing relevance and updates sync time afterward', async () => {
    const project = createProjectFromInput({ name: 'Mobile beta', goal: 'Ship the mobile beta.' });
    const getProject = vi.fn().mockResolvedValue(project);
    mocks.getStorageProvider.mockReturnValue({ getProject });
    const response = await POST(request({ action: 'sync', userId: 'calendar-user', projectId: project.id }));

    expect(response.status).toBe(200);
    expect(getProject).toHaveBeenCalledWith('calendar-user', project.id);
    expect(mocks.collectWorkspaceSignalsForUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'calendar-user',
      project,
    }));
    expect(mocks.updateIntegrationState).toHaveBeenCalledWith(
      'calendar-user',
      expect.objectContaining({ name: 'calendar', lastSyncAt: expect.any(String) }),
    );
  });

  it('returns not found when the requested project does not belong to the user', async () => {
    mocks.getStorageProvider.mockReturnValue({ getProject: vi.fn().mockResolvedValue(null) });

    const response = await POST(request({ action: 'sync', userId: 'calendar-user', projectId: 'other-project' }));

    expect(response.status).toBe(404);
    expect(mocks.collectWorkspaceSignalsForUser).not.toHaveBeenCalled();
  });
});

describe('GET /api/integrations/google connection state', () => {
  beforeEach(() => {
    vi.stubEnv('GAPSWISE_DEMO_MODE', 'false');
    vi.clearAllMocks();
    mocks.requireAuthenticatedUserId.mockResolvedValue('calendar-user');
    mocks.updateIntegrationState.mockImplementation(async (_userId: string, state: unknown) => [state]);
  });

  it('does not recreate an existing connection and erase its last sync time', async () => {
    const lastSyncAt = '2026-08-29T11:30:00.000Z';
    mocks.getIntegrationStates.mockResolvedValue([{
      ...createDemoConnectedState('calendar'),
      lastSyncAt,
    }]);

    const response = await GET(new Request('http://localhost/api/integrations/google'));
    const body = await response.json() as { integrations: Array<{ name: string; lastSyncAt?: string }> };

    expect(response.status).toBe(200);
    expect(body.integrations.find((state) => state.name === 'calendar')?.lastSyncAt).toBe(lastSyncAt);
    expect(mocks.updateIntegrationState).not.toHaveBeenCalled();
  });
});
