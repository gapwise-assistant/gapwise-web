import { GoogleIntegrationName, GoogleIntegrationState } from '@/types/google';
import { createDemoConnectedState, createDisconnectedState, disconnectIntegration } from '@/lib/google/auth';
import { getStorageProvider } from '@/lib/storage';

function defaultStates(): GoogleIntegrationState[] {
  return [
    createDisconnectedState('calendar'),
    createDisconnectedState('gmail'),
    createDisconnectedState('drive'),
  ];
}

export async function getIntegrationStates(userId: string): Promise<GoogleIntegrationState[]> {
  const stored = await getStorageProvider().getGoogleIntegrations?.(userId) ?? [];
  const byName = new Map(stored.map((state) => [state.name, state]));
  return defaultStates().map((fallback) => byName.get(fallback.name) ?? fallback);
}

async function saveIntegrationStates(
  userId: string,
  states: GoogleIntegrationState[],
): Promise<GoogleIntegrationState[]> {
  const storage = getStorageProvider();
  if (!storage.replaceGoogleIntegrations) {
    throw new Error('The configured storage provider cannot persist integration settings.');
  }
  await storage.replaceGoogleIntegrations(userId, states);
  return states;
}

export async function connectIntegration(
  userId: string,
  name: GoogleIntegrationName,
  options: Pick<GoogleIntegrationState, 'selectedLabels' | 'selectedDriveIds'> = {}
): Promise<GoogleIntegrationState[]> {
  const states = (await getIntegrationStates(userId)).map((state) =>
    state.name === name ? createDemoConnectedState(name, options) : state
  );
  return saveIntegrationStates(userId, states);
}

export async function updateIntegrationState(
  userId: string,
  updated: GoogleIntegrationState,
): Promise<GoogleIntegrationState[]> {
  const states = (await getIntegrationStates(userId)).map((state) => state.name === updated.name ? updated : state);
  return saveIntegrationStates(userId, states);
}

export async function disconnectIntegrationForUser(
  userId: string,
  name: GoogleIntegrationName,
): Promise<GoogleIntegrationState[]> {
  const states = (await getIntegrationStates(userId)).map((state) =>
    state.name === name ? disconnectIntegration(state) : state
  );
  return saveIntegrationStates(userId, states);
}
