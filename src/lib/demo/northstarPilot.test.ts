import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NORTHSTAR_PILOT_CONVERSATIONS,
  NORTHSTAR_PILOT_DEMO_ID,
  NORTHSTAR_PILOT_RESOLVED_SCOPE,
  findNorthstarSecurityAcceptanceGap,
} from '@/lib/demo/northstarPilot';
import { loadNorthstarPilotDemoForUser } from '@/lib/demo/bootstrap';
import { focusAssessmentCacheId, focusProjectStateVersion } from '@/lib/focus/focusCache';
import { getStorageProvider, resetStorageProviderForTests } from '@/lib/storage';

const tempDirs: string[] = [];
const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
const originalStorageMode = process.env.USE_FIRESTORE;
const originalMockStoragePath = process.env.GAPSWISE_MOCK_STORAGE_PATH;

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(async () => {
  resetStorageProviderForTests();
  restoreEnv('GAPSWISE_DEMO_MODE', originalDemoMode);
  restoreEnv('USE_FIRESTORE', originalStorageMode);
  restoreEnv('GAPSWISE_MOCK_STORAGE_PATH', originalMockStoragePath);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Northstar pilot demo', () => {
  it('replays user context, conversation-only assistant replies, decision resolution, history, and focus', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gapwise-northstar-pilot-'));
    tempDirs.push(dir);
    process.env.GAPSWISE_DEMO_MODE = 'true';
    process.env.USE_FIRESTORE = 'false';
    process.env.GAPSWISE_MOCK_STORAGE_PATH = path.join(dir, 'db.json');
    resetStorageProviderForTests();

    const userId = 'northstar-pilot-user';
    const result = await loadNorthstarPilotDemoForUser(userId);
    const storage = getStorageProvider();
    const messages = await storage.getAskMessages(userId);
    const assistantTexts = messages.filter((message) => message.role === 'assistant').map((message) => message.text);
    const securityGap = findNorthstarSecurityAcceptanceGap(result.project);
    const projectStateVersion = await focusProjectStateVersion(result.project);
    const focus = await storage.getFocusAssessment(
      userId,
      focusAssessmentCacheId(result.project.id, projectStateVersion),
    );

    expect(result.project.id).toBe(NORTHSTAR_PILOT_DEMO_ID);
    expect(result.project.title).toBe('Launch the Northstar Logistics pilot');
    expect(result.project.deadline).toBeUndefined();
    expect(result.project.sources).toHaveLength(NORTHSTAR_PILOT_CONVERSATIONS.length);
    expect(messages).toHaveLength(NORTHSTAR_PILOT_CONVERSATIONS.length * 2);
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(NORTHSTAR_PILOT_CONVERSATIONS.length);
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(NORTHSTAR_PILOT_CONVERSATIONS.length);

    const resolvedScope = result.project.nodes.find((node) => node.text === NORTHSTAR_PILOT_RESOLVED_SCOPE);
    expect(resolvedScope).toMatchObject({ type: 'DECISION', status: 'RESOLVED' });
    expect(result.project.history).toHaveLength(1);
    expect(result.project.history[0]?.answer).toBe(NORTHSTAR_PILOT_RESOLVED_SCOPE);
    expect(result.project.historyEvents?.filter((event) => event.type === 'context_added')).toHaveLength(NORTHSTAR_PILOT_CONVERSATIONS.length);
    expect(result.project.historyEvents?.some((event) => event.type === 'decision_resolved')).toBe(true);

    expect(securityGap).toMatchObject({ type: 'UNKNOWN', status: 'OPEN' });
    expect(securityGap?.text).toMatch(/confirm|accept|penetration/i);
    expect(result.project.edges.some((edge) => edge.type === 'resolves' && edge.target === securityGap?.id)).toBe(false);
    expect(focus?.assessment).toBeTruthy();

    for (const assistantText of assistantTexts) {
      expect(result.project.sources.some((source) => source.content.includes(assistantText))).toBe(false);
      expect(result.project.nodes.some((node) => node.text === assistantText)).toBe(false);
    }
  });
});
