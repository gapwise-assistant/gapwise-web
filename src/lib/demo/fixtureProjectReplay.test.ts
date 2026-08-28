import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import harborFixture from '@/lib/demo/fixtures/firestore/harbor-history-real.json';
import riversideFixture from '@/lib/demo/fixtures/firestore/riverside-delivery-failure.json';
import {
  GENERATOR_ASK_CASSETTES,
  GENERATOR_CONTEXT_CASSETTES,
  GENERATOR_RELATIONSHIP_CASSETTES,
  askCassetteFor,
  contextCassetteFor,
  type GeneratorRelationshipCassette,
} from '@/lib/demo/fixtures/generatorAiCassettes';
import { createHarborHistoryDemoForUser } from '@/lib/demo/harborHistory';
import { createRiversideHistoryDemoForUser } from '@/lib/demo/riversideHistory';
import { getStorageProvider, resetStorageProviderForTests } from '@/lib/storage';
import type { Project } from '@/types/clarity';

interface FixtureSummary {
  fixtureVersion: number;
  originalStatus: string;
  originalFailure: string | null;
  collections: {
    contexts: Array<{ title: string; goal: string; deadline?: string }>;
    nodes: Array<{ id: string; type: string; text: string }>;
    edges: Array<{ id: string; source: string; target: string; type: string }>;
    sources: Array<{ id: string; filename: string }>;
  };
  ask: { chats: unknown[]; messages: unknown[] };
  snapshots: unknown[];
}

const harbor = harborFixture as FixtureSummary;
const riverside = riversideFixture as FixtureSummary;

interface ExternalCall {
  callType: 'context_analysis' | 'relationship_completion' | 'ask' | 'assessment';
  journey: 'harbor' | 'riverside' | 'unknown';
  stepKey: string;
  requestIdentity: string;
}

const replay = vi.hoisted(() => ({
  model: vi.fn(),
  ask: vi.fn(),
  upload: vi.fn(),
  calls: [] as ExternalCall[],
  usedContext: new Set<string>(),
  usedAsk: new Set<string>(),
  usedRelationship: new Set<string>(),
  suggestionRefreshes: 0,
  unexpected: [] as string[],
}));

vi.mock('@/lib/google/genai', () => ({
  getVertexGenAIClient: () => ({ models: { generateContent: replay.model } }),
}));

vi.mock('@/lib/ask/adkClient', () => ({
  askGapswise: replay.ask,
}));

vi.mock('@/lib/storage/gcsAssets', () => ({
  uploadContextSourcePdf: replay.upload,
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function requestPrompt(request: unknown): string {
  const contents = (request as {
    contents?: Array<{ parts?: Array<{ text?: unknown }> }>;
  }).contents;
  return String(contents?.[0]?.parts?.find((part) => typeof part.text === 'string')?.text ?? '');
}

function jsonResponse(value: unknown, modelVersion = 'captured-contract-v1') {
  return { text: JSON.stringify(value), modelVersion };
}

function contextRequestIdentity(prompt: string): { filename: string; isAsk: boolean } {
  const match = prompt.match(/^New source filename: (.+)$/m);
  return {
    filename: match?.[1]?.trim() ?? '',
    isAsk: prompt.includes('Semantic source role: USER ASK MESSAGE.'),
  };
}

function journeyForPrompt(prompt: string): 'harbor' | 'riverside' | 'unknown' {
  const lower = prompt.toLowerCase();
  if (lower.includes('riverside')) return 'riverside';
  if (lower.includes('harbor')) return 'harbor';
  return 'unknown';
}

interface CompletionNode {
  id: string;
  type: string;
  text: string;
}

interface CompletionPair {
  pairId: string;
  sourceNodeId: string;
  targetNodeId: string;
  allowedTypes: string[];
}

function parseCompletionRequest(prompt: string): {
  nodes: CompletionNode[];
  pairs: CompletionPair[];
} {
  const serializedRequest = prompt.trim().split(/\r?\n/).at(-1) ?? '';
  if (!serializedRequest.startsWith('{')) return { nodes: [], pairs: [] };
  try {
    const value = JSON.parse(serializedRequest) as {
      nodes?: CompletionNode[];
      pairs?: CompletionPair[];
    };
    return { nodes: value.nodes ?? [], pairs: value.pairs ?? [] };
  } catch {
    return { nodes: [], pairs: [] };
  }
}

function completionResponseForCassette(
  prompt: string,
  cassette: GeneratorRelationshipCassette,
): { classifications: Array<Record<string, unknown>> } {
  const { nodes, pairs } = parseCompletionRequest(prompt);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const classifications = (cassette.relationshipRules ?? []).flatMap((rule) =>
    pairs.flatMap((pair) => {
      const source = nodesById.get(pair.sourceNodeId);
      const target = nodesById.get(pair.targetNodeId);
      if (
        source?.type !== rule.sourceType
        || source.text !== rule.sourceText
        || target?.type !== rule.targetType
        || target.text !== rule.targetText
        || !pair.allowedTypes.includes(rule.relationship)
      ) return [];
      return [{ pair_id: pair.pairId, relationship: rule.relationship, confidence: rule.confidence }];
    }),
  );
  return { classifications };
}

function resetReplayState(): void {
  replay.calls.length = 0;
  replay.usedContext.clear();
  replay.usedAsk.clear();
  replay.usedRelationship.clear();
  replay.suggestionRefreshes = 0;
  replay.unexpected.length = 0;
  replay.model.mockReset();
  replay.ask.mockReset();
  replay.upload.mockReset();
}

function configureExternalCassettes(): void {
  replay.upload.mockImplementation(async ({ sourceId, filename }: { sourceId: string; filename: string }) => ({
    storageUrl: `gs://cassette-bucket/users/test-user/sources/${sourceId}/${filename}`,
  }));

  replay.ask.mockImplementation(async ({ message }: { message: string }) => {
    if (message.includes('__gapswise_ask_suggestions__')) {
      replay.suggestionRefreshes += 1;
      return {
        answer: JSON.stringify({
          top_questions: ['Which remaining project uncertainty matters most?'],
          other_questions: ['What should be checked before launch?'],
        }),
      };
    }
    const turn = message.includes('validate')
      ? 'validation'
      : message.includes('volunteer drivers cancel')
        ? 'cancellations'
          : message.includes('meal price')
            ? 'pricing'
            : message.includes('deletion requirement')
              ? 'security-impact'
              : message.includes('procurement')
                ? 'procurement'
                : message.includes('clarify before')
                  ? 'planning'
                  : message;
    const cassette = askCassetteFor(turn);
    if (!cassette) {
      replay.unexpected.push(`Unexpected Ask request: ${message}`);
      throw new Error(`No Ask cassette for ${turn}.`);
    }
    replay.usedAsk.add(`${cassette.journey}:${cassette.stepKey}`);
    replay.calls.push({
      callType: 'ask',
      journey: cassette.journey,
      stepKey: cassette.stepKey,
      requestIdentity: `ask:${cassette.requestIdentity.askTurn}`,
    });
    return clone(cassette.response);
  });

  replay.model.mockImplementation(async (request: unknown) => {
    const prompt = requestPrompt(request);

    if (prompt.includes('You are the Project Overview Assessment agent.')) {
      replay.calls.push({
        callType: 'assessment',
        journey: journeyForPrompt(prompt),
        stepKey: 'overview',
        requestIdentity: 'overview-assessment',
      });
      return jsonResponse({
        trajectory: {
          state: 'taking_shape',
          explanation: 'The project is being assembled from the information recorded so far.',
        },
        summary: 'The project is being assembled from the information recorded so far, with later transitions still to be completed.',
        meaningfulChanges: [],
        goalImpact: {
          summary: 'The recorded project state provides the current basis for the journey.',
          positiveFactors: [],
          negativeFactors: [],
        },
        unsettled: [],
        criticalIssues: [],
        emergingInsights: [],
        confidence: 0.7,
      }, 'captured-assessment-contract-v1');
    }

    if (prompt.includes("canonical project-state interpreter")) {
      const { filename, isAsk } = contextRequestIdentity(prompt);
      if (isAsk) {
        return jsonResponse({
          summary: 'The user Ask message was retained as conversation context.',
          relevance: 'relevant',
          operations: [],
          relationships: [],
        });
      }
      const cassette = contextCassetteFor(filename);
      if (!cassette) {
        replay.unexpected.push(`Unexpected context source: ${filename}`);
        throw new Error(`No context cassette for ${filename}.`);
      }
      replay.usedContext.add(`${cassette.journey}:${cassette.stepKey}`);
      replay.calls.push({
        callType: 'context_analysis',
        journey: cassette.journey,
        stepKey: cassette.stepKey,
        requestIdentity: `filename:${filename}`,
      });
      return jsonResponse(cassette.response);
    }

    if (prompt.includes('completing a sparse reasoning graph')) {
      const journey = journeyForPrompt(prompt);
      const stepKey = prompt.includes('Ask proposal') ? 'ask_proposal' : 'document';
      const cassette = GENERATOR_RELATIONSHIP_CASSETTES.find((item) =>
        item.journey === journey && item.stepKey === stepKey,
      );
      if (!cassette) {
        replay.unexpected.push(`Unexpected relationship completion: ${journey}:${stepKey}`);
        throw new Error(`No relationship cassette for ${journey}:${stepKey}.`);
      }
      replay.usedRelationship.add(`${cassette.journey}:${cassette.stepKey}`);
      replay.calls.push({
        callType: 'relationship_completion',
        journey,
        stepKey,
        requestIdentity: `source:${cassette.requestIdentity.filenamePrefix}`,
      });
      return jsonResponse({
        ...clone(cassette.response),
        ...completionResponseForCassette(prompt, cassette),
      });
    }

    if (prompt.toLowerCase().includes('focus') || prompt.toLowerCase().includes('attention')) {
      replay.calls.push({
        callType: 'assessment',
        journey: journeyForPrompt(prompt),
        stepKey: 'focus',
        requestIdentity: 'focus-assessment',
      });
      return jsonResponse({ candidates: [] }, 'captured-assessment-contract-v1');
    }

    if (prompt.toLowerCase().includes('overview') || prompt.toLowerCase().includes('project trajectory')) {
      replay.calls.push({
        callType: 'assessment',
        journey: journeyForPrompt(prompt),
        stepKey: 'overview',
        requestIdentity: 'overview-assessment',
      });
      return jsonResponse({
        trajectory: {
          state: 'taking_shape',
          explanation: 'The project is being assembled from the information recorded so far.',
        },
        summary: 'The project is being assembled from the information recorded so far, with later transitions still to be completed.',
        meaningfulChanges: [],
        goalImpact: {
          summary: 'The recorded project state provides the current basis for the journey.',
          positiveFactors: [],
          negativeFactors: [],
        },
        unsettled: [],
        criticalIssues: [],
        emergingInsights: [],
        confidence: 0.7,
      }, 'captured-assessment-contract-v1');
    }

    replay.unexpected.push(`Unexpected model prompt: ${prompt.slice(0, 180)}`);
    throw new Error('Unexpected external model request in generator replay.');
  });
}

function assertUniqueIds(label: string, ids: string[]): void {
  expect(new Set(ids).size, `${label} IDs must be unique`).toBe(ids.length);
}

function assertNoDuplicateNodes(project: Project): void {
  const semanticKeys = new Set<string>();
  for (const node of project.nodes.filter((candidate) => candidate.status !== 'DEPRECATED')) {
    const key = `${node.type}:${node.text.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    expect(semanticKeys.has(key), `duplicate canonical node: ${key}`).toBe(false);
    semanticKeys.add(key);
  }
}

async function assertPersistedProject(
  userId: string,
  project: Project,
  expectedPdfCount: number,
): Promise<{ project: Project; snapshots: Awaited<ReturnType<ReturnType<typeof getStorageProvider>['listProjectSnapshots']>> }> {
  const storage = getStorageProvider();
  const reloaded = await storage.getProject(userId, project.id);
  expect(reloaded?.id).toBe(project.id);
  expect(reloaded).not.toBeNull();
  const saved = reloaded!;
  const snapshots = await storage.listProjectSnapshots(userId, project.id);

  expect(saved.sources.filter((source) => source.type === 'pdf')).toHaveLength(expectedPdfCount);
  expect(saved.sources.filter((source) => source.type === 'pdf').every((source) => source.processing_status === 'completed')).toBe(true);
  expect(saved.sources.filter((source) => source.type === 'pdf').every((source) => Boolean(source.storage_url))).toBe(true);
  expect(snapshots.length).toBeGreaterThan(0);
  expect(saved.historyEvents?.length).toBeGreaterThan(0);
  expect(saved.historyEvents?.every((event) => snapshots.some((snapshot) => snapshot.trigger.historyEventId === event.id))).toBe(true);

  assertUniqueIds('node', saved.nodes.map((node) => node.id));
  assertUniqueIds('edge', saved.edges.map((edge) => edge.id));
  assertUniqueIds('source', saved.sources.map((source) => source.id));
  assertUniqueIds('history event', (saved.historyEvents ?? []).map((event) => event.id));
  for (const edge of saved.edges) {
    expect(saved.nodes.some((node) => node.id === edge.source)).toBe(true);
    expect(saved.nodes.some((node) => node.id === edge.target)).toBe(true);
  }
  assertNoDuplicateNodes(saved);
  return { project: saved, snapshots };
}

function assertFixtureIntegrity(fixture: FixtureSummary, titleFragment: string): void {
  expect(fixture.fixtureVersion).toBe(1);
  expect(fixture.collections.contexts).toHaveLength(1);
  expect(fixture.collections.sources.length).toBeGreaterThan(0);
  expect(fixture.collections.nodes.length).toBeGreaterThan(0);
  expect(fixture.collections.edges.length).toBeGreaterThan(0);
  // The HarborHelp export is a sanitized source/graph capture without
  // historical snapshots. The real generator creates its own snapshots.
  expect(fixture.ask).toBeDefined();
  expect(fixture.collections.contexts[0]?.title).toContain(titleFragment);
}

function assertNoUnexpectedCalls(journey: 'harbor' | 'riverside'): void {
  expect(replay.unexpected, replay.unexpected.join('\n')).toEqual([]);
  expect(replay.usedContext).toEqual(new Set(
    GENERATOR_CONTEXT_CASSETTES
      .filter((cassette) => cassette.journey === journey)
      .map((cassette) => `${cassette.journey}:${cassette.stepKey}`),
  ));
  expect(replay.usedAsk).toEqual(new Set(
    GENERATOR_ASK_CASSETTES
      .filter((cassette) => cassette.journey === journey)
      .map((cassette) => `${cassette.journey}:${cassette.stepKey}`),
  ));
  expect(replay.usedRelationship).toEqual(new Set(
    GENERATOR_RELATIONSHIP_CASSETTES
      .filter((cassette) => cassette.journey === journey)
      .map((cassette) => `${cassette.journey}:${cassette.stepKey}`),
  ));
}

describe('deterministic generator E2E regression', () => {
  let storagePath = '';
  const environment: Record<string, string | undefined> = {};

  beforeEach(async () => {
    storagePath = await mkdtemp(path.join(os.tmpdir(), 'gapwise-generator-e2e-'));
    for (const key of ['USE_FIRESTORE', 'GAPSWISE_DEMO_MODE', 'GAPSWISE_MOCK_STORAGE_PATH', 'GAP_AGENT_MODE', 'CLOUD_STORAGE_BUCKET']) {
      environment[key] = process.env[key];
    }
    process.env.USE_FIRESTORE = 'false';
    process.env.GAPSWISE_DEMO_MODE = 'false';
    process.env.GAPSWISE_MOCK_STORAGE_PATH = path.join(storagePath, 'storage.json');
    process.env.GAP_AGENT_MODE = 'deterministic';
    process.env.CLOUD_STORAGE_BUCKET = 'cassette-bucket';
    resetStorageProviderForTests();
    resetReplayState();
    configureExternalCassettes();
  });

  afterEach(async () => {
    resetStorageProviderForTests();
    await rm(storagePath, { recursive: true, force: true });
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('runs the real Harbor generator through cassettes and reloads its final state', async () => {
    assertFixtureIntegrity(harbor, 'HarborHelp');
    const userId = 'test-user';
    let result: Awaited<ReturnType<typeof createHarborHistoryDemoForUser>>;
    try {
      result = await createHarborHistoryDemoForUser({ userId, fresh: true });
    } catch (error) {
      const storage = getStorageProvider();
      const stored = await storage.listProjects(userId);
      const runs = await storage.listDeveloperGenerationRuns(userId);
      const steps = runs[0] ? await storage.getDeveloperGenerationSteps(userId, runs[0].id) : [];
      throw new Error(JSON.stringify({
        journey: 'harbor',
        generationStep: 'generator',
        projectId: stored[0]?.id,
        nodeCount: stored[0]?.nodes.length,
        edgeCount: stored[0]?.edges.length,
        latestHistoryEvent: stored[0]?.historyEvents?.at(-1),
        generationRun: runs[0],
        generationSteps: steps,
        saveReloadStatus: stored.length ? 'partial project persisted' : 'no project persisted',
        expectedState: 'Harbor generator completes using only cassette-backed external calls',
        actualState: error instanceof Error ? error.message : String(error),
      }, null, 2));
    }

    const { project, snapshots } = await assertPersistedProject(userId, result.project, 5);
    expect(result.activeProjectId).toBe(project.id);
    expect(result.missingSnapshotEvents).toEqual([]);
    expect(result.addedProposalCount).toBe(4);
    expect(result.dismissedProposalCount).toBe(3);
    expect(result.pendingProposalCount).toBe(0);
    expect(result.chatCount).toBe(1);
    expect(result.messageCount).toBe(6);
    expect(result.snapshotCount).toBe(snapshots.length);
    expect(result.pdfSourcesWithCompletionTrace).toBe(5);
    expect(result.askProposalSourcesWithCompletionTrace).toBe(4);
    expect(replay.suggestionRefreshes).toBe(1);

    const resolvedDecisions = project.nodes.filter((node) => node.type === 'DECISION' && node.status === 'RESOLVED');
    expect(resolvedDecisions.length).toBeGreaterThanOrEqual(2);
    expect(project.nodes.some((node) => node.type === 'NEXT_ACTION' && node.status === 'OPEN' && /rehearsal/i.test(node.text))).toBe(true);
    const returnedSatisfiesEdges = result.project.edges.filter((edge) => edge.type === 'satisfies');
    const reloadedSatisfiesEdges = project.edges.filter((edge) => edge.type === 'satisfies');
    expect(reloadedSatisfiesEdges).toEqual(returnedSatisfiesEdges);
    const actionEvents = (project.historyEvents ?? []).filter((event) => event.type === 'action_completed');
    expect(new Set(actionEvents.map((event) => event.primaryNodeId)).size).toBe(actionEvents.length);
    assertNoUnexpectedCalls('harbor');
  }, 120_000);

  it('reproduces the Riverside captured failure inputs while the real generator completes the anchored journey', async () => {
    assertFixtureIntegrity(riverside, 'Riverside');
    expect(riverside.originalStatus).toBe('failed');
    expect(riverside.originalFailure).toContain('deliveryCoverage');
    const userId = 'test-user';
    let result: Awaited<ReturnType<typeof createRiversideHistoryDemoForUser>>;
    try {
      result = await createRiversideHistoryDemoForUser({ userId, fresh: true });
    } catch (error) {
      const storage = getStorageProvider();
      const stored = await storage.listProjects(userId);
      const runs = await storage.listDeveloperGenerationRuns(userId);
      const steps = runs[0] ? await storage.getDeveloperGenerationSteps(userId, runs[0].id) : [];
      throw new Error(JSON.stringify({
        journey: 'riverside',
        generationStep: 'generator',
        projectId: stored[0]?.id,
        anchorKey: 'deliveryCoverage',
        candidateNodeIds: stored[0]?.nodes.filter((node) => ['UNKNOWN', 'ASSUMPTION', 'DECISION', 'NEXT_ACTION'].includes(node.type)).map((node) => node.id),
        nodeCount: stored[0]?.nodes.length,
        edgeCount: stored[0]?.edges.length,
        latestHistoryEvent: stored[0]?.historyEvents?.at(-1),
        generationRun: runs[0],
        generationSteps: steps,
        saveReloadStatus: stored.length ? 'partial project persisted' : 'no project persisted',
        expectedState: 'delivery coverage is resolved and rehearsal remains actionable',
        actualState: error instanceof Error ? error.message : String(error),
      }, null, 2));
    }

    const { project, snapshots } = await assertPersistedProject(userId, result.project, 5);
    expect(result.missingSnapshotEvents).toEqual([]);
    expect(result.addedProposalCount).toBe(4);
    expect(result.dismissedProposalCount).toBe(3);
    expect(result.pendingProposalCount).toBe(0);
    expect(result.snapshotCount).toBe(snapshots.length);
    expect(result.pdfSourcesWithCompletionTrace).toBe(5);
    expect(result.askProposalSourcesWithCompletionTrace).toBe(4);
    expect(project.nodes.some((node) => node.status === 'RESOLVED' && /delivery coverage/i.test(node.text))).toBe(true);
    expect(project.nodes.some((node) => node.type === 'DECISION' && node.status === 'RESOLVED' && /meal price/i.test(node.text))).toBe(true);
    expect(project.nodes.some((node) => node.type === 'NEXT_ACTION' && node.status === 'OPEN' && /packing-and-delivery rehearsal/i.test(node.text))).toBe(true);
    const deliveryRule = GENERATOR_RELATIONSHIP_CASSETTES
      .find((cassette) => cassette.journey === 'riverside' && cassette.stepKey === 'ask_proposal')
      ?.relationshipRules?.[0];
    expect(deliveryRule).toBeDefined();
    const deliveryAction = project.nodes.find((node) =>
      node.type === deliveryRule?.sourceType && node.text === deliveryRule?.sourceText,
    );
    const deliveryOutcome = project.nodes.find((node) =>
      node.type === deliveryRule?.targetType && node.text === deliveryRule?.targetText,
    );
    expect(deliveryAction).toBeDefined();
    expect(deliveryOutcome).toBeDefined();
    expect(project.edges).toContainEqual(expect.objectContaining({
      source: deliveryAction?.id,
      target: deliveryOutcome?.id,
      type: deliveryRule?.relationship,
    }));
    expect(deliveryAction?.status).toBe('RESOLVED');
    const deliveryActionEvents = (project.historyEvents ?? []).filter((event) =>
      event.type === 'action_completed' && event.primaryNodeId === deliveryAction?.id,
    );
    expect(deliveryActionEvents).toHaveLength(1);
    expect(replay.suggestionRefreshes).toBe(1);
    assertNoUnexpectedCalls('riverside');
  }, 120_000);
});
