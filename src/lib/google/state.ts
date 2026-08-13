import { GoogleIntegrationName, GoogleIntegrationState } from '@/types/google';
import { createDemoConnectedState, createDisconnectedState, disconnectIntegration } from '@/lib/google/auth';

const integrationStore = new Map<string, GoogleIntegrationState[]>();

function defaultStates(): GoogleIntegrationState[] {
  return [
    createDisconnectedState('calendar'),
    createDisconnectedState('gmail'),
    createDisconnectedState('drive'),
  ];
}

export function getIntegrationStates(userId: string): GoogleIntegrationState[] {
  if (!integrationStore.has(userId)) {
    integrationStore.set(userId, defaultStates());
  }
  return integrationStore.get(userId)!;
}

export function connectIntegration(
  userId: string,
  name: GoogleIntegrationName,
  options: Pick<GoogleIntegrationState, 'selectedLabels' | 'selectedDriveIds'> = {}
): GoogleIntegrationState[] {
  const states = getIntegrationStates(userId).map((state) =>
    state.name === name ? createDemoConnectedState(name, options) : state
  );
  integrationStore.set(userId, states);
  return states;
}

export function updateIntegrationState(userId: string, updated: GoogleIntegrationState): GoogleIntegrationState[] {
  const states = getIntegrationStates(userId).map((state) => (state.name === updated.name ? updated : state));
  integrationStore.set(userId, states);
  return states;
}

export function disconnectIntegrationForUser(userId: string, name: GoogleIntegrationName): GoogleIntegrationState[] {
  const states = getIntegrationStates(userId).map((state) =>
    state.name === name ? disconnectIntegration(state) : state
  );
  integrationStore.set(userId, states);
  return states;
}

export function clearIntegrationStateForTests(): void {
  integrationStore.clear();
}
