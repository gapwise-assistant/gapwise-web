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
  ProjectOverviewAssessmentCacheRecord,
  DeveloperGenerationRun,
  DeveloperGenerationStep,
  StorageError,
  StorageProvider,
} from '@/lib/storage/types';
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
      projectSnapshots: ProjectSnapshot[];
      developerGenerationRuns: DeveloperGenerationRun[];
      developerGenerationSteps: DeveloperGenerationStep[];
      googleIntegrations: Array<GoogleIntegrationState & { id: string; userId: string }>;
    }
  >;
}

type MockCollectionName = keyof ProjectCollections | 'feedback' | 'events' | 'memories' | 'askChats' | 'askMessages' | 'askResearch' | 'focusAssessments' | 'projectOverviewAssessments' | 'askSuggestionAssessments' | 'projectSnapshots' | 'developerGenerationRuns' | 'developerGenerationSteps' | 'googleIntegrations';

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
  projectSnapshots: [],
  developerGenerationRuns: [],
  developerGenerationSteps: [],
  googleIntegrations: [],
};

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
      projectSnapshots: current.projectSnapshots ?? [],
      developerGenerationRuns: current.developerGenerationRuns ?? [],
      developerGenerationSteps: current.developerGenerationSteps ?? [],
      googleIntegrations: current.googleIntegrations ?? [],
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
      ?.filter((record) => record.projectId === projectId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  }

  async getProjectSemanticVersion(userId: string, projectId: string): Promise<string | null> {
    const context = (await this.getUser(userId)).contexts.find((candidate) => candidate.id === projectId);
    if (!context) return null;
    return context.semantic_version ?? '';
  }

  async saveAskSuggestionsCache(userId: string, record: AskSuggestionsCacheRecord): Promise<void> {
    await this.upsert(userId, 'askSuggestionAssessments', { ...record, userId });
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
      projectSnapshots: user?.projectSnapshots ?? [],
      developerGenerationRuns: user?.developerGenerationRuns ?? [],
      developerGenerationSteps: user?.developerGenerationSteps ?? [],
      googleIntegrations: user?.googleIntegrations ?? [],
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
