import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { connectIntegration, disconnectIntegrationForUser, getIntegrationStates } from '@/lib/google/state';
import { resetStorageProviderForTests } from '@/lib/storage';

describe('durable Google integration state', () => {
  beforeEach(async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'gapwise-integrations-'));
    vi.stubEnv('GAPSWISE_DEMO_MODE', 'true');
    vi.stubEnv('GAPSWISE_MOCK_STORAGE_PATH', path.join(directory, 'storage.json'));
    resetStorageProviderForTests();
  });

  afterEach(() => {
    resetStorageProviderForTests();
    vi.unstubAllEnvs();
  });

  it('survives a storage-provider restart and persists disconnects', async () => {
    await connectIntegration('settings-user', 'calendar');
    resetStorageProviderForTests();

    expect((await getIntegrationStates('settings-user')).find((state) => state.name === 'calendar')?.status)
      .toBe('connected');

    await disconnectIntegrationForUser('settings-user', 'calendar');
    resetStorageProviderForTests();

    expect((await getIntegrationStates('settings-user')).find((state) => state.name === 'calendar')?.status)
      .toBe('disconnected');
  });
});
