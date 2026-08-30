import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Project, UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { GoogleIntegrationState } from '@/types/google';
import { AppScope, EVERYTHING_SCOPE } from '@/types/scope';
import { AskChatMessage, AskChatSession, AskResearchEvidence } from '@/types/ask';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { collectionsToProject, collectionsToProjects, projectToCollections, ProjectCollections } from '@/lib/storage/projectMapper';
import {
  FirestoreContext,
  FirestoreConversation,
  FirestoreEdge,
  FirestoreEvent,
  FirestoreFeedback,
  FirestoreNode,
  FirestoreSource,
  FocusAssessmentCacheRecord,
  AskSuggestionsCacheRecord,
  CalendarRelevanceAssessmentCacheRecord,
  ProjectOverviewAssessmentCacheRecord,
  DeveloperGenerationRun,
  DeveloperGenerationStep,
  PublicDemoAskConsumption,
  PublicDemoAskOperation,
  PublicDemoAskReservation,
  PublicDemoDailyUsage,
  PublicDemoQuickDemoClaim,
  PublicDemoUsage,
  StorageError,
  StorageProvider,
} from '@/lib/storage/types';
import {
  compactPublicDemoAskOperations,
  createPublicDemoAskReservationId,
  hasValidPublicDemoAskLease,
  publicDemoAskOperations,
  PUBLIC_DEMO_ASK_RESERVATION_LEASE_MS,
} from '@/lib/publicDemo/askQuota';
import {
  PROJECT_SNAPSHOT_MAX_BYTES,
  projectSnapshotToSummary,
  snapshotRecordContentEqual,
  snapshotReferencesRecord,
  serializedProjectSnapshotSize,
  type ProjectSnapshot,
  type ProjectSnapshotSummary,
  type SnapshotReferencedRecordType,
} from '@/types/projectSnapshot';
import { askSuggestionsCurrentCacheId } from '@/lib/ask/suggestionsCacheId';
import {
  askSuggestionsInputVersion,
  createAskSuggestionsLease,
  hasValidAskSuggestionsLease,
} from '@/lib/ask/suggestionsLease';

interface MockDatabase {
  users: Record<
    string,
    ProjectCollections & {
      activeProjectId?: string;
      appScope?: AppScope;
      profile?: UserMemoryProfile;
      feedback: FirestoreFeedback[];
      events: FirestoreEvent[];
      memories: Array<DurableMemory & { userId: string }>;
      askChats: AskChatSession[];
      askMessages: AskChatMessage[];
      askResearch: AskResearchEvidence[];
      focusAssessments: FocusAssessmentCacheRecord[];
      projectOverviewAssessments: ProjectOverviewAssessmentCacheRecord[];
      askSuggestionAssessments: AskSuggestionsCacheRecord[];
      calendarRelevanceAssessments: CalendarRelevanceAssessmentCacheRecord[];
      projectSnapshots: ProjectSnapshot[];
      developerGenerationRuns: DeveloperGenerationRun[];
      developerGenerationSteps: DeveloperGenerationStep[];
      googleIntegrations: Array<GoogleIntegrationState & { id: string; userId: string }>;
      publicDemoUsage?: PublicDemoUsage;
    }
  >;
  publicDemoDailyUsage?: Record<string, PublicDemoDailyUsage>;
}

const PUBLIC_DEMO_MAX_ASK_MESSAGES = 3;
const PUBLIC_DEMO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function normalizedPublicDemoUsage(
  value: Partial<PublicDemoUsage> | undefined,
  userId: string,
  now = new Date().toISOString(),
): PublicDemoUsage {
  const askMessagesUsed = value?.askMessagesUsed;
  const createdAt = typeof value?.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    ? value.createdAt
    : now;
  const operations = publicDemoAskOperations(value, createdAt);
  return {
    userId,
    ...(value?.quickDemoProjectId ? { quickDemoProjectId: value.quickDemoProjectId } : {}),
    ...(value?.quickDemoCreatedAt ? { quickDemoCreatedAt: value.quickDemoCreatedAt } : {}),
    ...(value?.quickDemoStatus ? { quickDemoStatus: value.quickDemoStatus } : {}),
    askMessagesUsed: typeof askMessagesUsed === 'number' && Number.isInteger(askMessagesUsed) && askMessagesUsed >= 0
      ? askMessagesUsed
      : 0,
    askOperationIds: Array.isArray(value?.askOperationIds)
      ? value.askOperationIds.filter((item): item is string => typeof item === 'string')
      : [],
    ...(operations.length ? { askOperations: operations } : {}),
    createdAt,
    updatedAt: typeof value?.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))
      ? value.updatedAt
      : now,
    expiresAt: typeof value?.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt))
      ? value.expiresAt
      : new Date(Date.parse(createdAt) + PUBLIC_DEMO_RETENTION_MS).toISOString(),
  };
}

function normalizedPublicDemoDailyUsage(
  value: Partial<PublicDemoDailyUsage> | undefined,
  date: string,
  now: string,
): PublicDemoDailyUsage {
  const demosCreated = value?.demosCreated;
  const askMessagesUsed = value?.askMessagesUsed;
  return {
    date,
    demosCreated: typeof demosCreated === 'number' && Number.isInteger(demosCreated) && demosCreated >= 0
      ? demosCreated
      : 0,
    askMessagesUsed: typeof askMessagesUsed === 'number' && Number.isInteger(askMessagesUsed) && askMessagesUsed >= 0
      ? askMessagesUsed
      : 0,
    updatedAt: typeof value?.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))
      ? value.updatedAt
      : now,
  };
}

type MockCollectionName = keyof ProjectCollections | 'feedback' | 'events' | 'memories' | 'askChats' | 'askMessages' | 'askResearch' | 'focusAssessments' | 'projectOverviewAssessments' | 'askSuggestionAssessments' | 'calendarRelevanceAssessments' | 'projectSnapshots' | 'developerGenerationRuns' | 'developerGenerationSteps' | 'googleIntegrations';

const EMPTY_USER = {
  contexts: [],
  nodes: [],
  edges: [],
  sources: [],
  conversations: [],
  activeProjectId: undefined,
  appScope: undefined,
  profile: undefined,
  feedback: [],
  events: [],
  memories: [],
  askChats: [],
  askMessages: [],
  askResearch: [],
  focusAssessments: [],
  projectOverviewAssessments: [],
  askSuggestionAssessments: [],
  calendarRelevanceAssessments: [],
  projectSnapshots: [],
  developerGenerationRuns: [],
  developerGenerationSteps: [],
  googleIntegrations: [],
  publicDemoUsage: undefined,
};

// The JSON provider has no database transaction primitive. Serialize the
// public-demo allowance mutation per file so concurrent local requests obey
// the same single-consumer semantics as the Firestore transaction.
const mockAtomicWriteQueues = new Map<string, Promise<void>>();

async function withMockAtomicWrite<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = mockAtomicWriteQueues.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const current = previous.then(() => gate);
  mockAtomicWriteQueues.set(filePath, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (mockAtomicWriteQueues.get(filePath) === current) mockAtomicWriteQueues.delete(filePath);
  }
}

function snapshotReferences(
  snapshots: ProjectSnapshot[],
  type: SnapshotReferencedRecordType,
  id: string,
): boolean {
  return snapshots.some((snapshot) => snapshotReferencesRecord(snapshot, type, id));
}

function assertReferencedRecordCanChange(
  snapshots: ProjectSnapshot[],
  type: SnapshotReferencedRecordType,
  existing: unknown,
  next: unknown,
  id: string,
): void {
  if (!snapshotReferences(snapshots, type, id)) return;
  if (!existing) {
    throw new StorageError(`This ${type} is retained because a project snapshot references it.`, 'VALIDATION_ERROR');
  }
  if (!snapshotRecordContentEqual(type, existing, next)) {
    throw new StorageError(`This ${type} is immutable because a project snapshot references it.`, 'VALIDATION_ERROR');
  }
}

export class MockStorageProvider implements StorageProvider {
  readonly kind = 'mock' as const;
  readonly capabilities = {
    durableProjectState: false,
    durableSnapshots: false,
  } as const;

  constructor(
    private readonly filePath = process.env.GAPSWISE_MOCK_STORAGE_PATH?.trim()
      || path.join(process.cwd(), '.gapwise-data', 'mock-storage.json')
  ) {}

  async listProjects(userId: string): Promise<Project[]> {
    const user = await this.getUser(userId);
    return collectionsToProjects(user);
  }

  async getProject(userId: string, projectId?: string): Promise<Project | null> {
    const user = await this.getUser(userId);
    return collectionsToProject(user, projectId);
  }

  async saveProject(userId: string, project: Project): Promise<void> {
    const db = await this.readDb();
    const current = db.users[userId] ?? { ...EMPTY_USER };
    const nextProjectCollections = projectToCollections(userId, project);
    const currentSources = new Map(current.sources.map((source) => [source.id, source]));
    nextProjectCollections.sources.forEach((source) => {
      assertReferencedRecordCanChange(
        current.projectSnapshots,
        'source',
        currentSources.get(source.id),
        source,
        source.id,
      );
    });
    const incomingSourceIds = new Set(nextProjectCollections.sources.map((source) => source.id));
    const retainedSnapshotSources = current.sources.filter((source) =>
      source.projectId === project.id
      && !incomingSourceIds.has(source.id)
      && current.projectSnapshots.some((snapshot) => {
        if ('projectState' in snapshot) return snapshot.references.sourceIds.includes(source.id);
        return snapshot.project.sources.some((item) => item.id === source.id);
      }),
    );
    db.users[userId] = {
      contexts: this.replaceProjectRecords(current.contexts, nextProjectCollections.contexts, project.id),
      nodes: this.replaceProjectRecords(current.nodes, nextProjectCollections.nodes, project.id),
      edges: this.replaceProjectRecords(current.edges, nextProjectCollections.edges, project.id),
      sources: [
        ...this.replaceProjectRecords(current.sources, nextProjectCollections.sources, project.id),
        ...retainedSnapshotSources,
      ],
      conversations: this.replaceProjectRecords(
        current.conversations,
        nextProjectCollections.conversations,
        project.id
      ),
      activeProjectId: current.activeProjectId,
      appScope: current.appScope,
      feedback: current.feedback ?? [],
      events: current.events ?? [],
      memories: current.memories ?? [],
      askChats: current.askChats ?? [],
      askMessages: current.askMessages ?? [],
      askResearch: current.askResearch ?? [],
      focusAssessments: current.focusAssessments ?? [],
      projectOverviewAssessments: current.projectOverviewAssessments ?? [],
      askSuggestionAssessments: current.askSuggestionAssessments ?? [],
      calendarRelevanceAssessments: current.calendarRelevanceAssessments ?? [],
      projectSnapshots: current.projectSnapshots ?? [],
      developerGenerationRuns: current.developerGenerationRuns ?? [],
      developerGenerationSteps: current.developerGenerationSteps ?? [],
      googleIntegrations: current.googleIntegrations ?? [],
      publicDemoUsage: current.publicDemoUsage,
    };
    await this.writeDb(db);
  }

  async getActiveProjectId(userId: string): Promise<string | null> {
    return (await this.getUser(userId)).activeProjectId ?? null;
  }

  async setActiveProjectId(userId: string, projectId: string): Promise<void> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
    user.activeProjectId = projectId;
    db.users[userId] = user;
    await this.writeDb(db);
  }

  async getAppScope(userId: string): Promise<AppScope> {
    return (await this.getUser(userId)).appScope ?? EVERYTHING_SCOPE;
  }

  async setAppScope(userId: string, scope: AppScope): Promise<void> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
    user.appScope = scope;
    if (scope.type === 'project') user.activeProjectId = scope.projectId;
    db.users[userId] = user;
    await this.writeDb(db);
  }

  async getContexts(userId: string): Promise<FirestoreContext[]> {
    return (await this.getUser(userId)).contexts;
  }

  async saveContext(userId: string, context: FirestoreContext): Promise<void> {
    await this.upsert(userId, 'contexts', { ...context, userId });
  }

  async getNodes(userId: string): Promise<FirestoreNode[]> {
    return (await this.getUser(userId)).nodes;
  }

  async saveNode(userId: string, node: FirestoreNode): Promise<void> {
    await this.upsert(userId, 'nodes', { ...node, userId });
  }

  async deleteNode(userId: string, nodeId: string): Promise<void> {
    await this.remove(userId, 'nodes', nodeId);
  }

  async getEdges(userId: string): Promise<FirestoreEdge[]> {
    return (await this.getUser(userId)).edges;
  }

  async saveEdge(userId: string, edge: FirestoreEdge): Promise<void> {
    await this.upsert(userId, 'edges', { ...edge, userId });
  }

  async deleteEdge(userId: string, edgeId: string): Promise<void> {
    await this.remove(userId, 'edges', edgeId);
  }

  async getSources(userId: string): Promise<FirestoreSource[]> {
    return (await this.getUser(userId)).sources;
  }

  async saveSource(userId: string, source: FirestoreSource): Promise<void> {
    const user = await this.getUser(userId);
    assertReferencedRecordCanChange(
      user.projectSnapshots,
      'source',
      user.sources.find((candidate) => candidate.id === source.id),
      source,
      source.id,
    );
    await this.upsert(userId, 'sources', { ...source, userId });
  }

  async deleteSource(userId: string, sourceId: string): Promise<void> {
    const user = await this.getUser(userId);
    const referenced = snapshotReferences(user.projectSnapshots, 'source', sourceId);
    if (referenced) {
      throw new StorageError('This source is retained because a project snapshot references it.', 'VALIDATION_ERROR');
    }
    await this.remove(userId, 'sources', sourceId);
  }

  async getConversations(userId: string): Promise<FirestoreConversation[]> {
    return (await this.getUser(userId)).conversations;
  }

  async saveConversation(userId: string, conversation: FirestoreConversation): Promise<void> {
    await this.upsert(userId, 'conversations', { ...conversation, userId });
  }

  async getAskChats(userId: string): Promise<AskChatSession[]> {
    return (await this.getUser(userId)).askChats ?? [];
  }

  async saveAskChat(userId: string, chat: AskChatSession): Promise<void> {
    const user = await this.getUser(userId);
    assertReferencedRecordCanChange(
      user.projectSnapshots,
      'chat',
      user.askChats.find((candidate) => candidate.id === chat.id),
      chat,
      chat.id,
    );
    await this.upsert(userId, 'askChats', { ...chat, userId });
  }

  async deleteAskChat(userId: string, chatId: string): Promise<void> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
    const referenced = snapshotReferences(user.projectSnapshots, 'chat', chatId)
      || user.askMessages.some((message) => message.chatId === chatId && snapshotReferences(user.projectSnapshots, 'message', message.id))
      || user.askResearch.some((research) => research.chatId === chatId && snapshotReferences(user.projectSnapshots, 'research', research.id));
    if (referenced) {
      throw new StorageError('This chat is retained because a project snapshot references it.', 'VALIDATION_ERROR');
    }
    user.askChats = user.askChats.filter((chat) => chat.id !== chatId);
    user.askMessages = user.askMessages.filter((message) => message.chatId !== chatId);
    user.askResearch = user.askResearch.filter((research) => research.chatId !== chatId);
    db.users[userId] = user;
    await this.writeDb(db);
  }

  async getAskMessages(userId: string): Promise<AskChatMessage[]> {
    return (await this.getUser(userId)).askMessages ?? [];
  }

  async saveAskMessage(userId: string, message: AskChatMessage): Promise<void> {
    const user = await this.getUser(userId);
    assertReferencedRecordCanChange(
      user.projectSnapshots,
      'message',
      user.askMessages.find((candidate) => candidate.id === message.id),
      message,
      message.id,
    );
    await this.upsert(userId, 'askMessages', { ...message, userId });
  }

  async getAskResearch(userId: string): Promise<AskResearchEvidence[]> {
    return (await this.getUser(userId)).askResearch ?? [];
  }

  async saveAskResearch(userId: string, research: AskResearchEvidence): Promise<void> {
    const user = await this.getUser(userId);
    assertReferencedRecordCanChange(
      user.projectSnapshots,
      'research',
      user.askResearch.find((candidate) => candidate.id === research.id),
      research,
      research.id,
    );
    await this.upsert(userId, 'askResearch', { ...research, userId });
  }

  async getFocusAssessment(userId: string, cacheId: string): Promise<FocusAssessmentCacheRecord | null> {
    return (await this.getUser(userId)).focusAssessments?.find((record) => record.id === cacheId) ?? null;
  }

  async saveFocusAssessment(userId: string, record: FocusAssessmentCacheRecord): Promise<void> {
    await this.upsert(userId, 'focusAssessments', { ...record, userId });
  }

  async getProjectOverviewAssessment(userId: string, cacheId: string): Promise<ProjectOverviewAssessmentCacheRecord | null> {
    return (await this.getUser(userId)).projectOverviewAssessments?.find((record) => record.id === cacheId) ?? null;
  }

  async saveProjectOverviewAssessment(userId: string, record: ProjectOverviewAssessmentCacheRecord): Promise<void> {
    await this.upsert(userId, 'projectOverviewAssessments', { ...record, userId });
  }

  async getAskSuggestionsCache(userId: string, cacheId: string): Promise<AskSuggestionsCacheRecord | null> {
    return (await this.getUser(userId)).askSuggestionAssessments?.find((record) => record.id === cacheId) ?? null;
  }

  async getLatestAskSuggestionsCache(userId: string, projectId: string): Promise<AskSuggestionsCacheRecord | null> {
    return (await this.getUser(userId)).askSuggestionAssessments
      ?.find((record) => record.id === askSuggestionsCurrentCacheId(projectId)
        && record.projectId === projectId) ?? null;
  }

  async getProjectSemanticVersion(userId: string, projectId: string): Promise<string | null> {
    const context = (await this.getUser(userId)).contexts.find((candidate) => candidate.id === projectId);
    if (!context) return null;
    return context.semantic_version ?? '';
  }

  async saveAskSuggestionsCache(userId: string, record: AskSuggestionsCacheRecord): Promise<void> {
    await this.upsert(userId, 'askSuggestionAssessments', { ...record, userId });
  }

  async getCalendarRelevanceAssessment(userId: string, cacheId: string): Promise<CalendarRelevanceAssessmentCacheRecord | null> {
    return (await this.getUser(userId)).calendarRelevanceAssessments
      ?.find((record) => record.id === cacheId) ?? null;
  }

  async saveCalendarRelevanceAssessment(userId: string, record: CalendarRelevanceAssessmentCacheRecord): Promise<void> {
    await this.upsert(userId, 'calendarRelevanceAssessments', { ...record, userId });
  }

  async getPublicDemoUsage(userId: string): Promise<PublicDemoUsage | null> {
    const usage = (await this.getUser(userId)).publicDemoUsage;
    return usage ? normalizedPublicDemoUsage(usage, userId) : null;
  }

  async savePublicDemoUsage(userId: string, usage: PublicDemoUsage): Promise<void> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
    user.publicDemoUsage = { ...usage, userId };
    db.users[userId] = user;
    await this.writeDb(db);
  }

  async reservePublicDemoQuickDemo(params: {
    userId: string;
    projectId: string;
    createdAt: string;
    dailyLimit: number;
    now?: string;
  }): Promise<PublicDemoQuickDemoClaim> {
    if (!Number.isInteger(params.dailyLimit) || params.dailyLimit <= 0) {
      throw new StorageError('The public demo is temporarily unavailable.', 'CONFIGURATION_ERROR');
    }
    return withMockAtomicWrite(this.filePath, async () => {
      const db = await this.readDb();
      const user = db.users[params.userId] ?? { ...EMPTY_USER };
      const existing = user.publicDemoUsage
        ? normalizedPublicDemoUsage(user.publicDemoUsage, params.userId)
        : undefined;
      if (existing?.quickDemoProjectId) {
        if (existing.quickDemoStatus === 'failed' && existing.quickDemoProjectId === params.projectId) {
          user.publicDemoUsage = {
            ...existing,
            quickDemoStatus: 'creating',
            updatedAt: params.now ?? new Date().toISOString(),
          };
          db.users[params.userId] = user;
          await this.writeDb(db);
          return { claimed: true, projectId: existing.quickDemoProjectId, createdAt: existing.quickDemoCreatedAt ?? existing.createdAt };
        }
        return {
          claimed: false,
          projectId: existing.quickDemoProjectId,
          createdAt: existing.quickDemoCreatedAt ?? existing.createdAt,
        };
      }
      const now = params.now ?? new Date().toISOString();
      const date = now.slice(0, 10);
      const daily = normalizedPublicDemoDailyUsage(db.publicDemoDailyUsage?.[date], date, now);
      if (daily.demosCreated >= params.dailyLimit) {
        throw new StorageError('The public demo is temporarily unavailable.', 'UNAVAILABLE');
      }
      const parsedCreatedAt = Date.parse(params.createdAt);
      user.publicDemoUsage = {
        userId: params.userId,
        quickDemoProjectId: params.projectId,
        quickDemoCreatedAt: params.createdAt,
        quickDemoStatus: 'creating',
        askMessagesUsed: existing?.askMessagesUsed ?? 0,
        askOperationIds: existing?.askOperationIds ?? [],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        expiresAt: existing?.expiresAt ?? new Date(
          (Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.parse(now)) + PUBLIC_DEMO_RETENTION_MS,
        ).toISOString(),
      };
      db.publicDemoDailyUsage = {
        ...(db.publicDemoDailyUsage ?? {}),
        [date]: { ...daily, demosCreated: daily.demosCreated + 1, updatedAt: now },
      };
      db.users[params.userId] = user;
      await this.writeDb(db);
      return { claimed: true, projectId: params.projectId, createdAt: params.createdAt };
    });
  }

  async setPublicDemoQuickDemoStatus(params: {
    userId: string;
    projectId: string;
    status: 'creating' | 'ready' | 'failed';
  }): Promise<void> {
    return withMockAtomicWrite(this.filePath, async () => {
      const db = await this.readDb();
      const user = db.users[params.userId] ?? { ...EMPTY_USER };
      const current = user.publicDemoUsage;
      if (!current || current.quickDemoProjectId !== params.projectId) return;
      user.publicDemoUsage = { ...current, quickDemoStatus: params.status, updatedAt: new Date().toISOString() };
      db.users[params.userId] = user;
      await this.writeDb(db);
    });
  }

  async reservePublicDemoAsk(params: {
    userId: string;
    operationId: string;
    dailyLimit: number;
    now?: string;
    leaseMs?: number;
  }): Promise<PublicDemoAskReservation> {
    if (!Number.isInteger(params.dailyLimit) || params.dailyLimit <= 0) {
      throw new StorageError('The public demo is unavailable.', 'CONFIGURATION_ERROR');
    }
    const leaseMs = params.leaseMs ?? PUBLIC_DEMO_ASK_RESERVATION_LEASE_MS;
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
      throw new StorageError('The public demo is unavailable.', 'CONFIGURATION_ERROR');
    }
    return withMockAtomicWrite(this.filePath, async () => {
      const db = await this.readDb();
      const now = params.now ?? new Date().toISOString();
      const date = now.slice(0, 10);
      const user = db.users[params.userId] ?? { ...EMPTY_USER };
      const existing = normalizedPublicDemoUsage(user.publicDemoUsage, params.userId, now);
      const daily = normalizedPublicDemoDailyUsage(db.publicDemoDailyUsage?.[date], date, now);
      const operations = compactPublicDemoAskOperations(existing.askOperations ?? [], now);
      const current = operations.find((operation) => operation.operationId === params.operationId);
      if (current?.status === 'completed') {
        return {
          accepted: true,
          pending: false,
          alreadyCompleted: true,
          messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
          usage: existing,
        };
      }
      if (current && hasValidPublicDemoAskLease(current, now)) {
        return {
          accepted: false,
          pending: true,
          alreadyCompleted: false,
          messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
          usage: existing,
        };
      }
      const activePendingReservations = operations.filter((operation) => hasValidPublicDemoAskLease(operation, now)).length;
      if (existing.askMessagesUsed + activePendingReservations >= PUBLIC_DEMO_MAX_ASK_MESSAGES) {
        return {
          accepted: false,
          pending: false,
          alreadyCompleted: false,
          blockedReason: 'user_limit',
          messagesRemaining: 0,
          usage: existing,
        };
      }
      if (daily.askMessagesUsed >= params.dailyLimit) {
        return {
          accepted: false,
          pending: false,
          alreadyCompleted: false,
          blockedReason: 'daily_limit',
          messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
          usage: existing,
        };
      }

      const reservationId = createPublicDemoAskReservationId();
      const operation: PublicDemoAskOperation = {
        operationId: params.operationId,
        reservationId,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(),
      };
      const nextOperations = compactPublicDemoAskOperations(
        [...operations.filter((candidate) => candidate.operationId !== params.operationId), operation],
        now,
      );
      const usage: PublicDemoUsage = {
        ...existing,
        askOperations: nextOperations,
        updatedAt: now,
      };
      db.publicDemoDailyUsage = {
        ...(db.publicDemoDailyUsage ?? {}),
        [date]: { ...daily, askMessagesUsed: daily.askMessagesUsed + 1, updatedAt: now },
      };
      user.publicDemoUsage = usage;
      db.users[params.userId] = user;
      await this.writeDb(db);
      return {
        accepted: true,
        pending: false,
        alreadyCompleted: false,
        reservationId,
        messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
        usage,
      };
    });
  }

  async completePublicDemoAsk(params: {
    userId: string;
    operationId: string;
    reservationId?: string;
    assistantMessageId: string;
    now?: string;
  }): Promise<PublicDemoAskReservation> {
    return withMockAtomicWrite(this.filePath, async () => {
      const db = await this.readDb();
      const now = params.now ?? new Date().toISOString();
      const user = db.users[params.userId] ?? { ...EMPTY_USER };
      const existing = normalizedPublicDemoUsage(user.publicDemoUsage, params.userId, now);
      const operations = existing.askOperations ?? [];
      const current = operations.find((operation) => operation.operationId === params.operationId);
      if (!current) throw new StorageError('The public demo Ask reservation was not found.', 'VALIDATION_ERROR');
      if (current.status === 'completed') {
        return {
          accepted: true,
          pending: false,
          alreadyCompleted: true,
          messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
          usage: existing,
        };
      }
      if (params.reservationId && current.reservationId !== params.reservationId) {
        throw new StorageError('The public demo Ask reservation is no longer active.', 'VALIDATION_ERROR');
      }
      if (existing.askMessagesUsed >= PUBLIC_DEMO_MAX_ASK_MESSAGES) {
        throw new StorageError('The public demo Ask allowance is no longer available.', 'VALIDATION_ERROR');
      }
      const completed: PublicDemoAskOperation = {
        ...current,
        status: 'completed',
        updatedAt: now,
        completedAt: now,
        assistantMessageId: params.assistantMessageId,
        leaseExpiresAt: undefined,
      };
      const usage: PublicDemoUsage = {
        ...existing,
        askMessagesUsed: existing.askMessagesUsed + 1,
        askOperationIds: Array.from(new Set([...existing.askOperationIds, params.operationId])).slice(-PUBLIC_DEMO_MAX_ASK_MESSAGES),
        askOperations: operations.map((operation) => (
          operation.operationId === params.operationId ? completed : operation
        )),
        updatedAt: now,
      };
      user.publicDemoUsage = usage;
      db.users[params.userId] = user;
      await this.writeDb(db);
      return {
        accepted: true,
        pending: false,
        alreadyCompleted: false,
        messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - usage.askMessagesUsed),
        usage,
      };
    });
  }

  async releasePublicDemoAsk(params: {
    userId: string;
    operationId: string;
    reservationId: string;
    now?: string;
  }): Promise<void> {
    return withMockAtomicWrite(this.filePath, async () => {
      const db = await this.readDb();
      const now = params.now ?? new Date().toISOString();
      const user = db.users[params.userId] ?? { ...EMPTY_USER };
      const existing = user.publicDemoUsage
        ? normalizedPublicDemoUsage(user.publicDemoUsage, params.userId, now)
        : undefined;
      const current = existing?.askOperations?.find((operation) => operation.operationId === params.operationId);
      if (!existing || !current || current.status !== 'pending' || current.reservationId !== params.reservationId) return;
      user.publicDemoUsage = {
        ...existing,
        askOperations: existing.askOperations?.filter((operation) => operation.operationId !== params.operationId),
        updatedAt: now,
      };
      db.users[params.userId] = user;
      await this.writeDb(db);
    });
  }

  async consumePublicDemoAsk(params: {
    userId: string;
    operationId: string;
    dailyLimit: number;
    now?: string;
  }): Promise<PublicDemoAskConsumption> {
    return withMockAtomicWrite(this.filePath, () => this.consumePublicDemoAskUnlocked(params));
  }

  private async consumePublicDemoAskUnlocked(params: {
    userId: string;
    operationId: string;
    dailyLimit: number;
    now?: string;
  }): Promise<PublicDemoAskConsumption> {
    if (!Number.isInteger(params.dailyLimit) || params.dailyLimit <= 0) {
      throw new StorageError('The public demo is unavailable.', 'CONFIGURATION_ERROR');
    }
    const db = await this.readDb();
    const now = params.now ?? new Date().toISOString();
    const date = now.slice(0, 10);
    const user = db.users[params.userId] ?? { ...EMPTY_USER };
    const existing = normalizedPublicDemoUsage(user.publicDemoUsage, params.userId, now);
    const daily = normalizedPublicDemoDailyUsage(db.publicDemoDailyUsage?.[date], date, now);
    const alreadyConsumed = existing.askOperationIds.includes(params.operationId);
    if (alreadyConsumed) {
      return {
        accepted: true,
        alreadyConsumed: true,
        messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
        usage: existing,
      };
    }
    if (existing.askMessagesUsed >= PUBLIC_DEMO_MAX_ASK_MESSAGES || daily.askMessagesUsed >= params.dailyLimit) {
      return {
        accepted: false,
        alreadyConsumed: false,
        messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
        usage: existing,
      };
    }
    const usage: PublicDemoUsage = {
      ...existing,
      askMessagesUsed: existing.askMessagesUsed + 1,
      askOperationIds: [...existing.askOperationIds, params.operationId].slice(-PUBLIC_DEMO_MAX_ASK_MESSAGES),
      updatedAt: now,
    };
    db.publicDemoDailyUsage = {
      ...(db.publicDemoDailyUsage ?? {}),
      [date]: { ...daily, askMessagesUsed: daily.askMessagesUsed + 1, updatedAt: now },
    };
    user.publicDemoUsage = usage;
    db.users[params.userId] = user;
    await this.writeDb(db);
    return {
      accepted: true,
      alreadyConsumed: false,
      messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - usage.askMessagesUsed),
      usage,
    };
  }

  async beginAskSuggestionsRefresh(userId: string, record: AskSuggestionsCacheRecord): Promise<boolean> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
    const currentId = askSuggestionsCurrentCacheId(record.projectId ?? record.scopeKey);
    const existing = user.askSuggestionAssessments.find((candidate) => candidate.id === currentId);
    if (existing?.projectId && existing.projectId !== record.projectId) return false;
    if (
      existing?.status === 'preparing'
      && askSuggestionsInputVersion(existing) === askSuggestionsInputVersion(record)
      && hasValidAskSuggestionsLease(existing)
    ) return false;
    const now = record.requestedAt ?? record.updatedAt;
    const lease = createAskSuggestionsLease(now);
    const preparing: AskSuggestionsCacheRecord = {
      ...record,
      id: currentId,
      status: 'preparing',
      topQuestions: existing?.topQuestions ?? record.topQuestions,
      otherQuestions: existing?.otherQuestions ?? record.otherQuestions,
      createdAt: existing?.createdAt ?? record.createdAt,
      updatedAt: now,
      generationStartedAt: record.generationStartedAt ?? lease.generationStartedAt,
      generationLeaseExpiresAt: record.generationLeaseExpiresAt ?? lease.generationLeaseExpiresAt,
    };
    const index = user.askSuggestionAssessments.findIndex((candidate) => candidate.id === currentId);
    if (index >= 0) user.askSuggestionAssessments[index] = preparing;
    else user.askSuggestionAssessments.push(preparing);
    db.users[userId] = user;
    await this.writeDb(db);
    return true;
  }

  async publishAskSuggestionsCache(
    userId: string,
    record: AskSuggestionsCacheRecord,
    generationId: string,
  ): Promise<boolean> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
    const currentId = askSuggestionsCurrentCacheId(record.projectId ?? record.scopeKey);
    const index = user.askSuggestionAssessments.findIndex((candidate) => candidate.id === currentId);
    const current = index >= 0 ? user.askSuggestionAssessments[index] : undefined;
    if (
      !current
      || current.projectId !== record.projectId
      || current.generationId !== generationId
      || current.requestedSemanticProjectVersion !== record.requestedSemanticProjectVersion
      || askSuggestionsInputVersion(current) !== askSuggestionsInputVersion(record)
    ) return false;
    user.askSuggestionAssessments[index] = { ...record, id: currentId, generationId };
    db.users[userId] = user;
    await this.writeDb(db);
    return true;
  }

  async markAskSuggestionsStale(
    userId: string,
    projectId: string,
    requestedSemanticProjectVersion: string,
  ): Promise<void> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
    const currentId = askSuggestionsCurrentCacheId(projectId);
    const index = user.askSuggestionAssessments.findIndex((candidate) => candidate.id === currentId);
    const current = index >= 0 ? user.askSuggestionAssessments[index] : undefined;
    if (!current || current.projectId !== projectId) return;
    const now = new Date().toISOString();
    user.askSuggestionAssessments[index] = {
      ...current,
      status: 'stale',
      requestedSemanticProjectVersion,
      requestedAt: now,
      updatedAt: now,
      generationId: undefined,
      generationStartedAt: undefined,
      generationLeaseExpiresAt: undefined,
    };
    db.users[userId] = user;
    await this.writeDb(db);
  }

  async listDeveloperGenerationRuns(userId: string, projectId?: string): Promise<DeveloperGenerationRun[]> {
    return (await this.getUser(userId)).developerGenerationRuns
      .filter((run) => !projectId || run.projectId === projectId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async getDeveloperGenerationRun(userId: string, runId: string): Promise<DeveloperGenerationRun | null> {
    return (await this.getUser(userId)).developerGenerationRuns.find((run) => run.id === runId) ?? null;
  }

  async saveDeveloperGenerationRun(userId: string, run: DeveloperGenerationRun): Promise<void> {
    await this.upsert(userId, 'developerGenerationRuns', { ...run, userId });
  }

  async getDeveloperGenerationSteps(userId: string, runId: string): Promise<DeveloperGenerationStep[]> {
    return (await this.getUser(userId)).developerGenerationSteps
      .filter((step) => step.runId === runId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async saveDeveloperGenerationStep(userId: string, step: DeveloperGenerationStep): Promise<void> {
    await this.upsert(userId, 'developerGenerationSteps', { ...step, userId });
  }

  async listProjectSnapshots(userId: string, projectId: string): Promise<ProjectSnapshotSummary[]> {
    return (await this.getUser(userId)).projectSnapshots
      .filter((snapshot) => snapshot.projectId === projectId)
      .sort((left, right) => left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt))
      .map(projectSnapshotToSummary);
  }

  async getProjectSnapshot(userId: string, snapshotId: string): Promise<ProjectSnapshot | null> {
    return (await this.getUser(userId)).projectSnapshots.find((snapshot) => snapshot.id === snapshotId) ?? null;
  }

  async saveProjectSnapshot(userId: string, snapshot: ProjectSnapshot): Promise<void> {
    const size = serializedProjectSnapshotSize(snapshot);
    if (size > PROJECT_SNAPSHOT_MAX_BYTES) {
      throw new StorageError(`Project snapshot is too large to store (${size} bytes).`, 'VALIDATION_ERROR');
    }
    const existing = await this.getProjectSnapshot(userId, snapshot.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(snapshot)) {
        throw new Error('Project snapshots are immutable and cannot be overwritten.');
      }
      return;
    }
    await this.upsert(userId, 'projectSnapshots', { ...snapshot, userId });
  }

  async getFeedback(userId: string): Promise<FirestoreFeedback[]> {
    return (await this.getUser(userId)).feedback;
  }

  async saveFeedback(userId: string, feedback: FirestoreFeedback): Promise<void> {
    await this.upsert(userId, 'feedback', { ...feedback, userId });
  }

  async deleteFeedback(userId: string, feedbackId: string): Promise<void> {
    await this.remove(userId, 'feedback', feedbackId);
  }

  async getMemories(userId: string): Promise<DurableMemory[]> {
    return (await this.getUser(userId)).memories;
  }

  async saveMemory(userId: string, memory: DurableMemory): Promise<void> {
    await this.upsert(userId, 'memories', this.withMemoryAliases(userId, memory));
  }

  async replaceMemories(userId: string, memories: DurableMemory[]): Promise<void> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
    user.memories = memories.map((memory) => this.withMemoryAliases(userId, memory));
    db.users[userId] = user;
    await this.writeDb(db);
  }

  async getUserMemoryProfile(userId: string): Promise<UserMemoryProfile | null> {
    return (await this.getUser(userId)).profile ?? null;
  }

  async saveUserMemoryProfile(userId: string, profile: UserMemoryProfile): Promise<void> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
    user.profile = { ...profile };
    db.users[userId] = user;
    await this.writeDb(db);
  }

  async getGoogleIntegrations(userId: string): Promise<GoogleIntegrationState[]> {
    return (await this.getUser(userId)).googleIntegrations.map(({ id: _id, userId: _userId, ...state }) => state);
  }

  async replaceGoogleIntegrations(userId: string, integrations: GoogleIntegrationState[]): Promise<void> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
    user.googleIntegrations = integrations.map((integration) => ({
      ...integration,
      id: integration.name,
      userId,
    }));
    db.users[userId] = user;
    await this.writeDb(db);
  }

  async logEvent(userId: string, event: FirestoreEvent): Promise<void> {
    await this.upsert(userId, 'events', { ...event, userId });
  }

  async resetUserData(userId: string): Promise<void> {
    const db = await this.readDb();
    db.users[userId] = {
      contexts: [],
      nodes: [],
      edges: [],
      sources: [],
      conversations: [],
      activeProjectId: undefined,
      appScope: undefined,
      profile: undefined,
      feedback: [],
      events: [],
      memories: [],
      askChats: [],
      askMessages: [],
      askResearch: [],
      focusAssessments: [],
      projectOverviewAssessments: [],
      askSuggestionAssessments: [],
      calendarRelevanceAssessments: [],
      projectSnapshots: [],
      developerGenerationRuns: [],
      developerGenerationSteps: [],
      googleIntegrations: [],
    };
    await this.writeDb(db);
  }

  async resetDemoData(userId: string): Promise<void> {
    const demo = createGoldenDemoProject();
    await this.saveProject(userId, demo);
    await this.setAppScope(userId, { type: 'project', projectId: demo.id });
  }

  private async getUser(userId: string): Promise<MockDatabase['users'][string]> {
    const db = await this.readDb();
    const user = db.users[userId];
    return {
      ...EMPTY_USER,
      ...user,
      contexts: user?.contexts ?? [],
      nodes: user?.nodes ?? [],
      edges: user?.edges ?? [],
      sources: user?.sources ?? [],
      conversations: user?.conversations ?? [],
      feedback: user?.feedback ?? [],
      events: user?.events ?? [],
      memories: user?.memories ?? [],
      askChats: user?.askChats ?? [],
      askMessages: user?.askMessages ?? [],
      askResearch: user?.askResearch ?? [],
      focusAssessments: user?.focusAssessments ?? [],
      projectOverviewAssessments: user?.projectOverviewAssessments ?? [],
      askSuggestionAssessments: user?.askSuggestionAssessments ?? [],
      calendarRelevanceAssessments: user?.calendarRelevanceAssessments ?? [],
      projectSnapshots: user?.projectSnapshots ?? [],
      developerGenerationRuns: user?.developerGenerationRuns ?? [],
      developerGenerationSteps: user?.developerGenerationSteps ?? [],
      googleIntegrations: user?.googleIntegrations ?? [],
      publicDemoUsage: user?.publicDemoUsage,
    };
  }

  private async upsert<K extends MockCollectionName>(
    userId: string,
    collection: K,
    record: MockDatabase['users'][string][K][number]
  ): Promise<void> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
    const records = user[collection] as Array<{ id: string }>;
    const existingIndex = records.findIndex((item) => item.id === record.id);
    if (existingIndex >= 0) {
      records[existingIndex] = record;
    } else {
      records.push(record);
    }
    db.users[userId] = user;
    await this.writeDb(db);
  }

  private async remove<K extends keyof Pick<MockDatabase['users'][string], 'nodes' | 'edges' | 'sources' | 'feedback'>>(
    userId: string,
    collection: K,
    id: string
  ): Promise<void> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
    user[collection] = user[collection].filter((item) => item.id !== id) as MockDatabase['users'][string][K];
    db.users[userId] = user;
    await this.writeDb(db);
  }

  private replaceProjectRecords<T extends { id: string; projectId?: string; scope?: string }>(
    current: T[],
    incoming: T[],
    projectId: string
  ): T[] {
    const goldenProjectId = createGoldenDemoProject().id;
    const preserved = current.filter((item) => {
      if (item.scope === 'global') return true;
      if (item.projectId) return item.projectId !== projectId;
      if (incoming.some((incomingItem) => incomingItem.id === item.id)) return false;
      return projectId !== goldenProjectId;
    });
    return [...preserved, ...incoming];
  }

  private async readDb(): Promise<MockDatabase> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as MockDatabase;
    } catch {
      return { users: {} };
    }
  }

  private async writeDb(db: MockDatabase): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(db, null, 2), 'utf8');
  }

  private withMemoryAliases(userId: string, memory: DurableMemory): DurableMemory & { userId: string } {
    return {
      ...memory,
      userId,
      status: memory.forgotten_at || memory.status === 'forgotten' ? 'forgotten' : 'active',
      createdAt: memory.created_at,
      updatedAt: memory.updated_at,
      lastConfirmedAt: memory.last_confirmed_at,
      provenance: memory.why_remembered,
    };
  }
}
