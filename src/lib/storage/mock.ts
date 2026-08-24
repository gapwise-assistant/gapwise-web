import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
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
  StorageProvider,
} from '@/lib/storage/types';

interface MockDatabase {
  users: Record<
    string,
    ProjectCollections & {
      activeProjectId?: string;
      appScope?: AppScope;
      feedback: FirestoreFeedback[];
      events: FirestoreEvent[];
      memories: Array<DurableMemory & { userId: string }>;
      askChats: AskChatSession[];
      askMessages: AskChatMessage[];
      askResearch: AskResearchEvidence[];
      focusAssessments: FocusAssessmentCacheRecord[];
    }
  >;
}

type MockCollectionName = keyof ProjectCollections | 'feedback' | 'events' | 'memories' | 'askChats' | 'askMessages' | 'askResearch' | 'focusAssessments';

const EMPTY_USER = {
  contexts: [],
  nodes: [],
  edges: [],
  sources: [],
  conversations: [],
  activeProjectId: undefined,
  appScope: undefined,
  feedback: [],
  events: [],
  memories: [],
  askChats: [],
  askMessages: [],
  askResearch: [],
  focusAssessments: [],
};

export class MockStorageProvider implements StorageProvider {
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
    db.users[userId] = {
      contexts: this.replaceProjectRecords(current.contexts, nextProjectCollections.contexts, project.id),
      nodes: this.replaceProjectRecords(current.nodes, nextProjectCollections.nodes, project.id),
      edges: this.replaceProjectRecords(current.edges, nextProjectCollections.edges, project.id),
      sources: this.replaceProjectRecords(current.sources, nextProjectCollections.sources, project.id),
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
    await this.upsert(userId, 'sources', { ...source, userId });
  }

  async deleteSource(userId: string, sourceId: string): Promise<void> {
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
    await this.upsert(userId, 'askChats', { ...chat, userId });
  }

  async deleteAskChat(userId: string, chatId: string): Promise<void> {
    const db = await this.readDb();
    const user = db.users[userId] ?? { ...EMPTY_USER };
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
    await this.upsert(userId, 'askMessages', { ...message, userId });
  }

  async getAskResearch(userId: string): Promise<AskResearchEvidence[]> {
    return (await this.getUser(userId)).askResearch ?? [];
  }

  async saveAskResearch(userId: string, research: AskResearchEvidence): Promise<void> {
    await this.upsert(userId, 'askResearch', { ...research, userId });
  }

  async getFocusAssessment(userId: string, cacheId: string): Promise<FocusAssessmentCacheRecord | null> {
    return (await this.getUser(userId)).focusAssessments?.find((record) => record.id === cacheId) ?? null;
  }

  async saveFocusAssessment(userId: string, record: FocusAssessmentCacheRecord): Promise<void> {
    await this.upsert(userId, 'focusAssessments', { ...record, userId });
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
      feedback: [],
      events: [],
      memories: [],
      askChats: [],
      askMessages: [],
      askResearch: [],
      focusAssessments: [],
    };
    await this.writeDb(db);
  }

  async resetDemoData(userId: string): Promise<void> {
    const demo = createGoldenDemoProject();
    await this.saveProject(userId, demo);
    await this.setAppScope(userId, EVERYTHING_SCOPE);
  }

  private async getUser(userId: string): Promise<MockDatabase['users'][string]> {
    const db = await this.readDb();
    return db.users[userId] ?? { ...EMPTY_USER };
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
      status: memory.forgotten_at ? 'forgotten' : 'active',
      createdAt: memory.created_at,
      updatedAt: memory.updated_at,
      lastConfirmedAt: memory.last_confirmed_at,
      provenance: memory.why_remembered,
    };
  }
}
