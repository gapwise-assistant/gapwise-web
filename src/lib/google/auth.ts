import { GoogleIntegrationName, GoogleIntegrationState } from '@/types/google';

const READ_ONLY_SCOPES: Record<GoogleIntegrationName, string[]> = {
  calendar: ['https://www.googleapis.com/auth/calendar.readonly'],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly'],
  drive: ['https://www.googleapis.com/auth/drive.readonly'],
};

export function createDisconnectedState(name: GoogleIntegrationName): GoogleIntegrationState {
  return {
    name,
    status: 'disconnected',
    readOnly: true,
    scopes: READ_ONLY_SCOPES[name],
    selectedLabels: name === 'gmail' ? [] : undefined,
    selectedDriveIds: name === 'drive' ? [] : undefined,
  };
}

export function createDemoConnectedState(
  name: GoogleIntegrationName,
  options: Pick<GoogleIntegrationState, 'selectedLabels' | 'selectedDriveIds'> = {}
): GoogleIntegrationState {
  return {
    ...createDisconnectedState(name),
    status: 'connected',
    connectedAt: new Date().toISOString(),
    ...options,
  };
}

export function assertCanRead(state: GoogleIntegrationState): void {
  if (state.status === 'permission_denied') {
    throw new Error(`${state.name} permission denied. Reconnect with read-only access.`);
  }
  if (state.status === 'token_expired') {
    throw new Error(`${state.name} token expired. Reconnect to refresh access.`);
  }
  if (state.status !== 'connected') {
    throw new Error(`${state.name} is disconnected.`);
  }
  if (!state.readOnly) {
    throw new Error(`${state.name} must use read-only access for this milestone.`);
  }
}

export function disconnectIntegration(state: GoogleIntegrationState): GoogleIntegrationState {
  return {
    ...state,
    status: 'disconnected',
    connectedAt: undefined,
    lastSyncAt: undefined,
  };
}
