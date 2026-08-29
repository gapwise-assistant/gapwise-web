import { FieldValue, Firestore } from 'firebase-admin/firestore';
import type { ContextProcessingLog, Project, UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { GoogleIntegrationState } from '@/types/google';
import { AppScope, EVERYTHING_SCOPE } from '@/types/scope';
import { AskChatMessage, AskChatSession, AskResearchEvidence } from '@/types/ask';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { getFirestoreClient } from '@/lib/firebase-admin';
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
import { compactProcessingLogForFirestore } from '@/lib/context/processingLog';
import { askSuggestionsCurrentCacheId } from '@/lib/ask/suggestionsCacheId';
import {
  askSuggestionsInputVersion,
  createAskSuggestionsLease,
  hasValidAskSuggestionsLease,
} from '@/lib/ask/suggestionsLease';

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

type CollectionName = keyof ProjectCollections | 'feedback' | 'events' | 'memories' | 'askChats' | 'askMessages' | 'askResearch' | 'focusAssessments' | 'projectOverviewAssessments' | 'askSuggestionAssessments' | 'projectSnapshots' | 'developerGenerationRuns' | 'developerGenerationSteps' | 'googleIntegrations';

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)])
    ) as T;
  }
  return value;
}

function firestoreSafeRecord<T>(record: T): T {
  if (!record || typeof record !== 'object') return stripUndefined(record);
  const candidate = record as Record<string, unknown>;
  const withSafeProcessingLog = 'processing_log' in candidate && candidate.processing_log
    ? {
        ...candidate,
        processing_log: compactProcessingLogForFirestore(candidate.processing_log as ContextProcessingLog),
      }
    : record;
  return stripUndefined(withSafeProcessingLog) as T;
}

function snapshotsReferenceRecord(
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
  if (!snapshotsReferenceRecord(snapshots, type, id)) return;
  if (!existing) {
    throw new StorageError(`This ${type} is retained because a project snapshot references it.`, 'VALIDATION_ERROR');
  }
  if (!snapshotRecordContentEqual(type, existing, next)) {
    throw new StorageError(`This ${type} is immutable because a project snapshot references it.`, 'VALIDATION_ERROR');
  }
}

export class FirestoreStorageProvider implements StorageProvider {
  readonly kind = 'firestore' as const;
  readonly capabilities = {
    durableProjectState: true,
    durableSnapshots: true,
  } as const;

  constructor(private readonly db: Firestore = getFirestoreClient()) {}

  async listProjects(userId: string): Promise<Project[]> {
    const [contexts, nodes, edges, sources, conversations] = await Promise.all([
      this.getContexts(userId),
      this.getNodes(userId),
      this.getEdges(userId),
      this.getSources(userId),
      this.getConversations(userId),
    ]);
    return collectionsToProjects({ contexts, nodes, edges, sources, conversations });
  }

  async getProject(userId: string, projectId?: string): Promise<Project | null> {
    const [contexts, nodes, edges, sources, conversations] = await Promise.all([
      this.getContexts(userId),
      this.getNodes(userId),
      this.getEdges(userId),
      this.getSources(userId),
      this.getConversations(userId),
    ]);
    return collectionsToProject({ contexts, nodes, edges, sources, conversations }, projectId);
  }

  async saveProject(userId: string, project: Project): Promise<void> {
    const collections = projectToCollections(userId, project);
    const batch = this.db.batch();
    const snapshots = await this.list<ProjectSnapshot>(userId, 'projectSnapshots');
    const currentSources = new Map((await this.getSources(userId)).map((source) => [source.id, source]));
    collections.sources.forEach((source) => {
      assertReferencedRecordCanChange(
        snapshots,
        'source',
        currentSources.get(source.id),
        source,
        source.id,
      );
    });

    await Promise.all(
      (Object.keys(collections) as Array<keyof ProjectCollections>).map(async (collection) => {
        const snapshot = await this.collection(userId, collection).get();
        snapshot.docs
          .filter((doc) => this.belongsToProject(collection, doc.id, doc.data(), project.id))
          .filter((doc) => collection !== 'sources' || snapshots.some((savedSnapshot) => {
            if ('projectState' in savedSnapshot) return savedSnapshot.references.sourceIds.includes(doc.id);
            return savedSnapshot.project.sources.some((source) => source.id === doc.id);
          }) === false)
          .forEach((doc) => batch.delete(doc.ref));
        collections[collection].forEach((record) => {
          batch.set(this.collection(userId, collection).doc(record.id), firestoreSafeRecord(this.withServerUpdatedAt(record)));
        });
      })
    );

    await batch.commit();
  }

  async getActiveProjectId(userId: string): Promise<string | null> {
    try {
      const snapshot = await this.db.collection('users').doc(userId).collection('preferences').doc('app').get();
      const value = snapshot.data()?.activeProjectId;
      return typeof value === 'string' && value.trim() ? value : null;
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async setActiveProjectId(userId: string, projectId: string): Promise<void> {
    try {
      await this.db.collection('users').doc(userId).collection('preferences').doc('app').set(
        stripUndefined(
          this.withServerUpdatedAt({
            id: 'app',
            userId,
            activeProjectId: projectId,
            updatedAt: new Date().toISOString(),
          })
        ),
        { merge: true }
      );
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async getAppScope(userId: string): Promise<AppScope> {
    try {
      const snapshot = await this.db.collection('users').doc(userId).collection('preferences').doc('app').get();
      const data = snapshot.data();
      if (data?.scopeType === 'project' && typeof data.scopeProjectId === 'string' && data.scopeProjectId.trim()) {
        return { type: 'project', projectId: data.scopeProjectId };
      }
      return EVERYTHING_SCOPE;
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async setAppScope(userId: string, scope: AppScope): Promise<void> {
    try {
      await this.db.collection('users').doc(userId).collection('preferences').doc('app').set(
        stripUndefined(
          this.withServerUpdatedAt({
            id: 'app',
            userId,
            scopeType: scope.type,
            scopeProjectId: scope.type === 'project' ? scope.projectId : undefined,
            activeProjectId: scope.type === 'project' ? scope.projectId : undefined,
            updatedAt: new Date().toISOString(),
          })
        ),
        { merge: true }
      );
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async getContexts(userId: string): Promise<FirestoreContext[]> {
    return this.list<FirestoreContext>(userId, 'contexts');
  }

  async saveContext(userId: string, context: FirestoreContext): Promise<void> {
    await this.save(userId, 'contexts', context);
  }

  async getNodes(userId: string): Promise<FirestoreNode[]> {
    return this.list<FirestoreNode>(userId, 'nodes');
  }

  async saveNode(userId: string, node: FirestoreNode): Promise<void> {
    await this.save(userId, 'nodes', node);
  }

  async deleteNode(userId: string, nodeId: string): Promise<void> {
    await this.collection(userId, 'nodes').doc(nodeId).delete();
  }

  async getEdges(userId: string): Promise<FirestoreEdge[]> {
    return this.list<FirestoreEdge>(userId, 'edges');
  }

  async saveEdge(userId: string, edge: FirestoreEdge): Promise<void> {
    await this.save(userId, 'edges', edge);
  }

  async deleteEdge(userId: string, edgeId: string): Promise<void> {
    await this.collection(userId, 'edges').doc(edgeId).delete();
  }

  async getSources(userId: string): Promise<FirestoreSource[]> {
    return this.list<FirestoreSource>(userId, 'sources');
  }

  async saveSource(userId: string, source: FirestoreSource): Promise<void> {
    const [sources, snapshots] = await Promise.all([
      this.getSources(userId),
      this.list<ProjectSnapshot>(userId, 'projectSnapshots'),
    ]);
    assertReferencedRecordCanChange(
      snapshots,
      'source',
      sources.find((candidate) => candidate.id === source.id),
      source,
      source.id,
    );
    await this.save(userId, 'sources', source);
  }

  async deleteSource(userId: string, sourceId: string): Promise<void> {
    const snapshots = await this.list<ProjectSnapshot>(userId, 'projectSnapshots');
    const referenced = snapshotsReferenceRecord(snapshots, 'source', sourceId);
    if (referenced) {
      throw new StorageError('This source is retained because a project snapshot references it.', 'VALIDATION_ERROR');
    }
    await this.collection(userId, 'sources').doc(sourceId).delete();
  }

  async getConversations(userId: string): Promise<FirestoreConversation[]> {
    return this.list<FirestoreConversation>(userId, 'conversations');
  }

  async saveConversation(userId: string, conversation: FirestoreConversation): Promise<void> {
    await this.save(userId, 'conversations', conversation);
  }

  async getAskChats(userId: string): Promise<AskChatSession[]> {
    return this.list<AskChatSession>(userId, 'askChats');
  }

  async saveAskChat(userId: string, chat: AskChatSession): Promise<void> {
    const [chats, snapshots] = await Promise.all([
      this.getAskChats(userId),
      this.list<ProjectSnapshot>(userId, 'projectSnapshots'),
    ]);
    assertReferencedRecordCanChange(
      snapshots,
      'chat',
      chats.find((candidate) => candidate.id === chat.id),
      chat,
      chat.id,
    );
    await this.save(userId, 'askChats', chat);
  }

  async deleteAskChat(userId: string, chatId: string): Promise<void> {
    try {
      const snapshots = await this.list<ProjectSnapshot>(userId, 'projectSnapshots');
      const messages = await this.getAskMessages(userId);
      const research = await this.getAskResearch(userId);
      const referenced = snapshotsReferenceRecord(snapshots, 'chat', chatId)
        || messages.some((message) => message.chatId === chatId && snapshotsReferenceRecord(snapshots, 'message', message.id))
        || research.some((item) => item.chatId === chatId && snapshotsReferenceRecord(snapshots, 'research', item.id));
      if (referenced) {
        throw new StorageError('This chat is retained because a project snapshot references it.', 'VALIDATION_ERROR');
      }
      const batch = this.db.batch();
      batch.delete(this.collection(userId, 'askChats').doc(chatId));
      messages
        .filter((message) => message.chatId === chatId)
        .forEach((message) => batch.delete(this.collection(userId, 'askMessages').doc(message.id)));
      research
        .filter((item) => item.chatId === chatId)
        .forEach((item) => batch.delete(this.collection(userId, 'askResearch').doc(item.id)));
      await batch.commit();
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async getAskMessages(userId: string): Promise<AskChatMessage[]> {
    return this.list<AskChatMessage>(userId, 'askMessages');
  }

  async saveAskMessage(userId: string, message: AskChatMessage): Promise<void> {
    const [messages, snapshots] = await Promise.all([
      this.getAskMessages(userId),
      this.list<ProjectSnapshot>(userId, 'projectSnapshots'),
    ]);
    assertReferencedRecordCanChange(
      snapshots,
      'message',
      messages.find((candidate) => candidate.id === message.id),
      message,
      message.id,
    );
    await this.save(userId, 'askMessages', message);
  }

  async getAskResearch(userId: string): Promise<AskResearchEvidence[]> {
    return this.list<AskResearchEvidence>(userId, 'askResearch');
  }

  async saveAskResearch(userId: string, research: AskResearchEvidence): Promise<void> {
    const [researchRecords, snapshots] = await Promise.all([
      this.getAskResearch(userId),
      this.list<ProjectSnapshot>(userId, 'projectSnapshots'),
    ]);
    assertReferencedRecordCanChange(
      snapshots,
      'research',
      researchRecords.find((candidate) => candidate.id === research.id),
      research,
      research.id,
    );
    await this.save(userId, 'askResearch', research);
  }

  async getFocusAssessment(userId: string, cacheId: string): Promise<FocusAssessmentCacheRecord | null> {
    try {
      const snapshot = await this.collection(userId, 'focusAssessments').doc(cacheId).get();
      return snapshot.exists ? this.fromFirestore<FocusAssessmentCacheRecord>(snapshot.data()!) : null;
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async saveFocusAssessment(userId: string, record: FocusAssessmentCacheRecord): Promise<void> {
    await this.save(userId, 'focusAssessments', record);
  }

  async getProjectOverviewAssessment(userId: string, cacheId: string): Promise<ProjectOverviewAssessmentCacheRecord | null> {
    try {
      const snapshot = await this.collection(userId, 'projectOverviewAssessments').doc(cacheId).get();
      return snapshot.exists
        ? this.fromFirestore<ProjectOverviewAssessmentCacheRecord>(snapshot.data()!)
        : null;
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async saveProjectOverviewAssessment(userId: string, record: ProjectOverviewAssessmentCacheRecord): Promise<void> {
    await this.save(userId, 'projectOverviewAssessments', record);
  }

  async getAskSuggestionsCache(userId: string, cacheId: string): Promise<AskSuggestionsCacheRecord | null> {
    try {
      const snapshot = await this.collection(userId, 'askSuggestionAssessments').doc(cacheId).get();
      return snapshot.exists
        ? this.fromFirestore<AskSuggestionsCacheRecord>(snapshot.data()!)
        : null;
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async getLatestAskSuggestionsCache(userId: string, projectId: string): Promise<AskSuggestionsCacheRecord | null> {
    try {
      const snapshot = await this.collection(userId, 'askSuggestionAssessments')
        .doc(askSuggestionsCurrentCacheId(projectId))
        .get();
      if (!snapshot.exists) return null;
      const record = this.fromFirestore<AskSuggestionsCacheRecord>(snapshot.data()!);
      return record.projectId === projectId ? record : null;
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async getProjectSemanticVersion(userId: string, projectId: string): Promise<string | null> {
    try {
      const snapshot = await this.collection(userId, 'contexts').doc(projectId).get();
      if (!snapshot.exists) return null;
      const value = snapshot.data()?.semantic_version;
      return typeof value === 'string' ? value : '';
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async saveAskSuggestionsCache(userId: string, record: AskSuggestionsCacheRecord): Promise<void> {
    await this.save(userId, 'askSuggestionAssessments', record);
  }

  async getPublicDemoUsage(userId: string): Promise<PublicDemoUsage | null> {
    try {
      const snapshot = await this.db.collection('users').doc(userId).collection('preferences').doc('publicDemoUsage').get();
      if (!snapshot.exists) return null;
      return normalizedPublicDemoUsage(this.fromFirestore<PublicDemoUsage>(snapshot.data()!), userId);
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async savePublicDemoUsage(userId: string, usage: PublicDemoUsage): Promise<void> {
    try {
      await this.db.collection('users').doc(userId).collection('preferences').doc('publicDemoUsage').set(
        firestoreSafeRecord(this.withServerUpdatedAt({ ...usage, userId })),
        { merge: false },
      );
    } catch (error) {
      throw this.toStorageError(error);
    }
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
    try {
      const ref = this.db.collection('users').doc(params.userId).collection('preferences').doc('publicDemoUsage');
      const date = (params.now ?? new Date().toISOString()).slice(0, 10);
      const dailyRef = this.db.collection('publicDemoDailyUsage').doc(date);
      let result: PublicDemoQuickDemoClaim | undefined;
      await this.db.runTransaction(async (transaction) => {
        const [snapshot, dailySnapshot] = await transaction.getAll(ref, dailyRef);
        const existing = snapshot.exists
          ? normalizedPublicDemoUsage(this.fromFirestore<PublicDemoUsage>(snapshot.data()!), params.userId)
          : undefined;
        if (existing?.quickDemoProjectId) {
          // A failed reservation may be retried with the same stable project
          // identity without consuming another daily creation allowance.
          if (existing.quickDemoStatus === 'failed' && existing.quickDemoProjectId === params.projectId) {
            const now = params.now ?? new Date().toISOString();
            transaction.set(ref, firestoreSafeRecord(this.withServerUpdatedAt({
              ...existing,
              quickDemoStatus: 'creating' as const,
              updatedAt: now,
            })), { merge: false });
            result = { claimed: true, projectId: existing.quickDemoProjectId, createdAt: existing.quickDemoCreatedAt ?? existing.createdAt };
            return;
          }
          result = {
            claimed: false,
            projectId: existing.quickDemoProjectId,
            createdAt: existing.quickDemoCreatedAt ?? existing.createdAt,
          };
          return;
        }

        const now = params.now ?? new Date().toISOString();
        const daily = normalizedPublicDemoDailyUsage(
          dailySnapshot.exists ? this.fromFirestore<PublicDemoDailyUsage>(dailySnapshot.data()!) : undefined,
          date,
          now,
        );
        if (daily.demosCreated >= params.dailyLimit) {
          throw new StorageError('The public demo is temporarily unavailable.', 'UNAVAILABLE');
        }
        const parsedCreatedAt = Date.parse(params.createdAt);
        const expiresAt = new Date(
          (Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.parse(now)) + PUBLIC_DEMO_RETENTION_MS,
        ).toISOString();
        const usage: PublicDemoUsage = {
          userId: params.userId,
          quickDemoProjectId: params.projectId,
          quickDemoCreatedAt: params.createdAt,
          quickDemoStatus: 'creating',
          askMessagesUsed: existing?.askMessagesUsed ?? 0,
          askOperationIds: existing?.askOperationIds ?? [],
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          expiresAt: existing?.expiresAt ?? expiresAt,
        };
        transaction.set(ref, firestoreSafeRecord(this.withServerUpdatedAt(usage)), { merge: false });
        transaction.set(dailyRef, firestoreSafeRecord(this.withServerUpdatedAt({
          ...daily,
          date,
          demosCreated: daily.demosCreated + 1,
          updatedAt: now,
        })));
        result = { claimed: true, projectId: params.projectId, createdAt: params.createdAt };
      });
      if (!result) throw new StorageError('The public demo workspace reservation failed.', 'UNAVAILABLE');
      return result;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw this.toStorageError(error);
    }
  }

  async setPublicDemoQuickDemoStatus(params: {
    userId: string;
    projectId: string;
    status: 'creating' | 'ready' | 'failed';
  }): Promise<void> {
    try {
      const ref = this.db.collection('users').doc(params.userId).collection('preferences').doc('publicDemoUsage');
      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const current = this.fromFirestore<PublicDemoUsage>(snapshot.data()!);
        if (current.quickDemoProjectId !== params.projectId) return;
        transaction.set(ref, firestoreSafeRecord(this.withServerUpdatedAt({
          ...current,
          quickDemoStatus: params.status,
          updatedAt: new Date().toISOString(),
        })), { merge: false });
      });
    } catch (error) {
      throw this.toStorageError(error);
    }
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
    try {
      const userUsageRef = this.db.collection('users').doc(params.userId).collection('preferences').doc('publicDemoUsage');
      const now = params.now ?? new Date().toISOString();
      const date = now.slice(0, 10);
      const dailyUsageRef = this.db.collection('publicDemoDailyUsage').doc(date);
      let result: PublicDemoAskReservation | undefined;
      await this.db.runTransaction(async (transaction) => {
        const [userSnapshot, dailySnapshot] = await transaction.getAll(userUsageRef, dailyUsageRef);
        const existing = normalizedPublicDemoUsage(
          userSnapshot.exists ? this.fromFirestore<PublicDemoUsage>(userSnapshot.data()!) : undefined,
          params.userId,
          now,
        );
        const daily = normalizedPublicDemoDailyUsage(
          dailySnapshot.exists ? this.fromFirestore<PublicDemoDailyUsage>(dailySnapshot.data()!) : undefined,
          date,
          now,
        );
        const operations = compactPublicDemoAskOperations(existing.askOperations ?? [], now);
        const current = operations.find((operation) => operation.operationId === params.operationId);
        if (current?.status === 'completed') {
          result = {
            accepted: true,
            pending: false,
            alreadyCompleted: true,
            messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
            usage: existing,
          };
          return;
        }
        if (current && hasValidPublicDemoAskLease(current, now)) {
          result = {
            accepted: false,
            pending: true,
            alreadyCompleted: false,
            messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
            usage: existing,
          };
          return;
        }
        const activePendingReservations = operations.filter((operation) => hasValidPublicDemoAskLease(operation, now)).length;
        if (existing.askMessagesUsed + activePendingReservations >= PUBLIC_DEMO_MAX_ASK_MESSAGES) {
          result = {
            accepted: false,
            pending: false,
            alreadyCompleted: false,
            blockedReason: 'user_limit',
            messagesRemaining: 0,
            usage: existing,
          };
          return;
        }
        if (daily.askMessagesUsed >= params.dailyLimit) {
          result = {
            accepted: false,
            pending: false,
            alreadyCompleted: false,
            blockedReason: 'daily_limit',
            messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
            usage: existing,
          };
          return;
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
        transaction.set(userUsageRef, firestoreSafeRecord(this.withServerUpdatedAt(usage)), { merge: false });
        transaction.set(dailyUsageRef, firestoreSafeRecord(this.withServerUpdatedAt({
          ...daily,
          date,
          askMessagesUsed: daily.askMessagesUsed + 1,
          updatedAt: now,
        })), { merge: false });
        result = {
          accepted: true,
          pending: false,
          alreadyCompleted: false,
          reservationId,
          messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
          usage,
        };
      });
      if (!result) throw new StorageError('The public demo usage check failed.', 'UNAVAILABLE');
      return result;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw this.toStorageError(error);
    }
  }

  async completePublicDemoAsk(params: {
    userId: string;
    operationId: string;
    reservationId?: string;
    assistantMessageId: string;
    now?: string;
  }): Promise<PublicDemoAskReservation> {
    try {
      const userUsageRef = this.db.collection('users').doc(params.userId).collection('preferences').doc('publicDemoUsage');
      const now = params.now ?? new Date().toISOString();
      let result: PublicDemoAskReservation | undefined;
      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(userUsageRef);
        const existing = normalizedPublicDemoUsage(
          snapshot.exists ? this.fromFirestore<PublicDemoUsage>(snapshot.data()!) : undefined,
          params.userId,
          now,
        );
        const operations = existing.askOperations ?? [];
        const current = operations.find((operation) => operation.operationId === params.operationId);
        if (!current) throw new StorageError('The public demo Ask reservation was not found.', 'VALIDATION_ERROR');
        if (current.status === 'completed') {
          result = {
            accepted: true,
            pending: false,
            alreadyCompleted: true,
            messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
            usage: existing,
          };
          return;
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
        const nextOperations = operations.map((operation) => (
          operation.operationId === params.operationId ? completed : operation
        ));
        const nextAskOperationIds = Array.from(new Set([
          ...existing.askOperationIds,
          params.operationId,
        ])).slice(-PUBLIC_DEMO_MAX_ASK_MESSAGES);
        const usage: PublicDemoUsage = {
          ...existing,
          askMessagesUsed: existing.askMessagesUsed + 1,
          askOperationIds: nextAskOperationIds,
          askOperations: nextOperations,
          updatedAt: now,
        };
        transaction.set(userUsageRef, firestoreSafeRecord(this.withServerUpdatedAt(usage)), { merge: false });
        result = {
          accepted: true,
          pending: false,
          alreadyCompleted: false,
          messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - usage.askMessagesUsed),
          usage,
        };
      });
      if (!result) throw new StorageError('The public demo Ask completion failed.', 'UNAVAILABLE');
      return result;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw this.toStorageError(error);
    }
  }

  async releasePublicDemoAsk(params: {
    userId: string;
    operationId: string;
    reservationId: string;
    now?: string;
  }): Promise<void> {
    try {
      const userUsageRef = this.db.collection('users').doc(params.userId).collection('preferences').doc('publicDemoUsage');
      const now = params.now ?? new Date().toISOString();
      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(userUsageRef);
        if (!snapshot.exists) return;
        const existing = normalizedPublicDemoUsage(this.fromFirestore<PublicDemoUsage>(snapshot.data()!), params.userId, now);
        const current = existing.askOperations?.find((operation) => operation.operationId === params.operationId);
        if (!current || current.status !== 'pending' || current.reservationId !== params.reservationId) return;
        const usage: PublicDemoUsage = {
          ...existing,
          askOperations: existing.askOperations?.filter((operation) => operation.operationId !== params.operationId),
          updatedAt: now,
        };
        transaction.set(userUsageRef, firestoreSafeRecord(this.withServerUpdatedAt(usage)), { merge: false });
      });
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async consumePublicDemoAsk(params: {
    userId: string;
    operationId: string;
    dailyLimit: number;
    now?: string;
  }): Promise<PublicDemoAskConsumption> {
    if (!Number.isInteger(params.dailyLimit) || params.dailyLimit <= 0) {
      throw new StorageError('The public demo is unavailable.', 'CONFIGURATION_ERROR');
    }
    try {
      const userUsageRef = this.db.collection('users').doc(params.userId).collection('preferences').doc('publicDemoUsage');
      const now = params.now ?? new Date().toISOString();
      const date = now.slice(0, 10);
      const dailyUsageRef = this.db.collection('publicDemoDailyUsage').doc(date);
      let result: PublicDemoAskConsumption | undefined;
      await this.db.runTransaction(async (transaction) => {
        const [userSnapshot, dailySnapshot] = await transaction.getAll(
          userUsageRef,
          dailyUsageRef,
        );
        const existing = normalizedPublicDemoUsage(
          userSnapshot.exists ? this.fromFirestore<PublicDemoUsage>(userSnapshot.data()!) : undefined,
          params.userId,
          now,
        );
        const daily = normalizedPublicDemoDailyUsage(
          dailySnapshot.exists ? this.fromFirestore<PublicDemoDailyUsage>(dailySnapshot.data()!) : undefined,
          date,
          now,
        );
        const alreadyConsumed = existing.askOperationIds.includes(params.operationId);
        if (alreadyConsumed) {
          result = {
            accepted: true,
            alreadyConsumed: true,
            messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
            usage: existing,
          };
          return;
        }
        if (existing.askMessagesUsed >= PUBLIC_DEMO_MAX_ASK_MESSAGES || daily.askMessagesUsed >= params.dailyLimit) {
          result = {
            accepted: false,
            alreadyConsumed: false,
            messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - existing.askMessagesUsed),
            usage: existing,
          };
          return;
        }
        const usage: PublicDemoUsage = {
          ...existing,
          askMessagesUsed: existing.askMessagesUsed + 1,
          askOperationIds: [...existing.askOperationIds, params.operationId].slice(-PUBLIC_DEMO_MAX_ASK_MESSAGES),
          updatedAt: now,
        };
        transaction.set(userUsageRef, firestoreSafeRecord(this.withServerUpdatedAt(usage)));
        transaction.set(dailyUsageRef, firestoreSafeRecord(this.withServerUpdatedAt({
          ...daily,
          date,
          askMessagesUsed: daily.askMessagesUsed + 1,
          updatedAt: now,
        })));
        result = {
          accepted: true,
          alreadyConsumed: false,
          messagesRemaining: Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - usage.askMessagesUsed),
          usage,
        };
      });
      if (!result) throw new StorageError('The public demo usage check failed.', 'UNAVAILABLE');
      return result;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw this.toStorageError(error);
    }
  }

  async beginAskSuggestionsRefresh(userId: string, record: AskSuggestionsCacheRecord): Promise<boolean> {
    try {
      const ref = this.collection(userId, 'askSuggestionAssessments')
        .doc(askSuggestionsCurrentCacheId(record.projectId ?? record.scopeKey));
      let started = false;
      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const existing = snapshot.exists
          ? this.fromFirestore<AskSuggestionsCacheRecord>(snapshot.data()!)
          : null;
        if (existing?.projectId && existing.projectId !== record.projectId) return;
        if (
          existing?.status === 'preparing'
          && askSuggestionsInputVersion(existing) === askSuggestionsInputVersion(record)
          && hasValidAskSuggestionsLease(existing)
        ) return;

        const now = record.requestedAt ?? record.updatedAt;
        const lease = createAskSuggestionsLease(now);
        const preparing: AskSuggestionsCacheRecord = {
          ...record,
          id: ref.id,
          status: 'preparing',
          topQuestions: existing?.topQuestions ?? record.topQuestions,
          otherQuestions: existing?.otherQuestions ?? record.otherQuestions,
          createdAt: existing?.createdAt ?? record.createdAt,
          updatedAt: now,
          generationStartedAt: record.generationStartedAt ?? lease.generationStartedAt,
          generationLeaseExpiresAt: record.generationLeaseExpiresAt ?? lease.generationLeaseExpiresAt,
        };
        transaction.set(ref, firestoreSafeRecord(this.withServerUpdatedAt(preparing)));
        started = true;
      });
      return started;
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async publishAskSuggestionsCache(
    userId: string,
    record: AskSuggestionsCacheRecord,
    generationId: string,
  ): Promise<boolean> {
    try {
      const ref = this.collection(userId, 'askSuggestionAssessments')
        .doc(askSuggestionsCurrentCacheId(record.projectId ?? record.scopeKey));
      let published = false;
      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const current = this.fromFirestore<AskSuggestionsCacheRecord>(snapshot.data()!);
        if (
          current.projectId !== record.projectId
          || current.generationId !== generationId
          || current.requestedSemanticProjectVersion !== record.requestedSemanticProjectVersion
          || askSuggestionsInputVersion(current) !== askSuggestionsInputVersion(record)
        ) return;
        transaction.set(ref, firestoreSafeRecord(this.withServerUpdatedAt({
          ...record,
          id: ref.id,
          projectId: current.projectId,
          generationId,
        })));
        published = true;
      });
      return published;
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async markAskSuggestionsStale(
    userId: string,
    projectId: string,
    requestedSemanticProjectVersion: string,
  ): Promise<void> {
    try {
      const ref = this.collection(userId, 'askSuggestionAssessments')
        .doc(askSuggestionsCurrentCacheId(projectId));
      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const current = this.fromFirestore<AskSuggestionsCacheRecord>(snapshot.data()!);
        if (current.projectId !== projectId) return;
        const now = new Date().toISOString();
        transaction.set(ref, firestoreSafeRecord(this.withServerUpdatedAt({
          ...current,
          status: 'stale' as const,
          requestedSemanticProjectVersion,
          requestedAt: now,
          updatedAt: now,
          generationId: undefined,
          generationStartedAt: undefined,
          generationLeaseExpiresAt: undefined,
        })), { merge: false });
      });
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async listDeveloperGenerationRuns(userId: string, projectId?: string): Promise<DeveloperGenerationRun[]> {
    try {
      let query: FirebaseFirestore.Query = this.collection(userId, 'developerGenerationRuns');
      if (projectId) query = query.where('projectId', '==', projectId);
      const snapshot = await query.get();
      return snapshot.docs
        .map((doc) => this.fromFirestore<DeveloperGenerationRun>(doc.data()))
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async getDeveloperGenerationRun(userId: string, runId: string): Promise<DeveloperGenerationRun | null> {
    try {
      const snapshot = await this.collection(userId, 'developerGenerationRuns').doc(runId).get();
      return snapshot.exists ? this.fromFirestore<DeveloperGenerationRun>(snapshot.data()!) : null;
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async saveDeveloperGenerationRun(userId: string, run: DeveloperGenerationRun): Promise<void> {
    await this.save(userId, 'developerGenerationRuns', run);
  }

  async getDeveloperGenerationSteps(userId: string, runId: string): Promise<DeveloperGenerationStep[]> {
    try {
      const snapshot = await this.collection(userId, 'developerGenerationSteps')
        .where('runId', '==', runId)
        .get();
      return snapshot.docs
        .map((doc) => this.fromFirestore<DeveloperGenerationStep>(doc.data()))
        .sort((left, right) => left.sequence - right.sequence);
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async saveDeveloperGenerationStep(userId: string, step: DeveloperGenerationStep): Promise<void> {
    await this.save(userId, 'developerGenerationSteps', step);
  }

  async listProjectSnapshots(userId: string, projectId: string): Promise<ProjectSnapshotSummary[]> {
    try {
      // V2 stores a small listing index, so opening History does not read the
      // project graph, source metadata, Ask records, or assessments for every
      // historical moment. Legacy v1 documents are fetched individually only
      // when they are encountered.
      const projected = await this.collection(userId, 'projectSnapshots')
        .where('projectId', '==', projectId)
        .select('id', 'userId', 'projectId', 'sequence', 'createdAt', 'trigger', 'label', 'summary', 'schemaVersion', 'listSummary')
        .get();
      const summaries: ProjectSnapshotSummary[] = [];
      const legacyRefs: FirebaseFirestore.DocumentReference[] = [];
      projected.docs.forEach((doc) => {
        const partial = this.fromFirestore<Partial<ProjectSnapshot>>(doc.data());
        if (partial.projectId !== projectId) return;
        if (partial.schemaVersion === 2 && 'listSummary' in partial && partial.listSummary) {
          summaries.push(projectSnapshotToSummary(partial as ProjectSnapshot));
        } else {
          legacyRefs.push(doc.ref);
        }
      });
      const legacySnapshots = await Promise.all(legacyRefs.map(async (ref) => {
        const doc = await ref.get();
        return doc.exists ? this.fromFirestore<ProjectSnapshot>(doc.data()!) : null;
      }));
      summaries.push(...legacySnapshots
        .filter((snapshot): snapshot is ProjectSnapshot => snapshot !== null)
        .filter((snapshot) => snapshot.projectId === projectId)
        .map(projectSnapshotToSummary));
      return summaries.sort((left, right) => left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt));
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async getProjectSnapshot(userId: string, snapshotId: string): Promise<ProjectSnapshot | null> {
    try {
      const snapshot = await this.collection(userId, 'projectSnapshots').doc(snapshotId).get();
      return snapshot.exists ? this.fromFirestore<ProjectSnapshot>(snapshot.data()!) : null;
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async saveProjectSnapshot(userId: string, snapshot: ProjectSnapshot): Promise<void> {
    const size = serializedProjectSnapshotSize(snapshot);
    if (size > PROJECT_SNAPSHOT_MAX_BYTES) {
      throw new StorageError(`Project snapshot is too large to store (${size} bytes).`, 'VALIDATION_ERROR');
    }
    const ref = this.collection(userId, 'projectSnapshots').doc(snapshot.id);
    try {
      const existing = await ref.get();
      if (existing.exists) {
        const stored = this.fromFirestore<ProjectSnapshot>(existing.data()!);
        if (JSON.stringify(stored) !== JSON.stringify(snapshot)) {
          throw new StorageError('Project snapshots are immutable and cannot be overwritten.', 'VALIDATION_ERROR');
        }
        return;
      }
      await ref.create(stripUndefined({ ...snapshot, userId }));
    } catch (error) {
      if (error instanceof StorageError) throw error;
      // Two identical transitions can race. Re-read after an ALREADY_EXISTS
      // response and accept only the identical immutable record.
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      if (code.includes('already-exists') || code === '6') {
        const existing = await ref.get();
        if (existing.exists) {
          const stored = this.fromFirestore<ProjectSnapshot>(existing.data()!);
          if (JSON.stringify(stored) === JSON.stringify(snapshot)) return;
          throw new StorageError('Project snapshots are immutable and cannot be overwritten.', 'VALIDATION_ERROR');
        }
      }
      throw this.toStorageError(error);
    }
  }

  async getFeedback(userId: string): Promise<FirestoreFeedback[]> {
    return this.list<FirestoreFeedback>(userId, 'feedback');
  }

  async saveFeedback(userId: string, feedback: FirestoreFeedback): Promise<void> {
    await this.save(userId, 'feedback', feedback);
  }

  async deleteFeedback(userId: string, feedbackId: string): Promise<void> {
    await this.collection(userId, 'feedback').doc(feedbackId).delete();
  }

  async getMemories(userId: string): Promise<DurableMemory[]> {
    return this.list<DurableMemory & { userId: string }>(userId, 'memories');
  }

  async saveMemory(userId: string, memory: DurableMemory): Promise<void> {
    await this.save(userId, 'memories', this.withMemoryAliases(userId, memory));
  }

  async replaceMemories(userId: string, memories: DurableMemory[]): Promise<void> {
    const batch = this.db.batch();
    const snapshot = await this.collection(userId, 'memories').get();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    memories.forEach((memory) => {
      batch.set(
        this.collection(userId, 'memories').doc(memory.id),
        stripUndefined(this.withServerUpdatedAt(this.withMemoryAliases(userId, memory)))
      );
    });
    await batch.commit();
  }

  async getUserMemoryProfile(userId: string): Promise<UserMemoryProfile | null> {
    try {
      const snapshot = await this.db.collection('users').doc(userId).collection('preferences').doc('profile').get();
      if (!snapshot.exists) return null;
      const data = this.fromFirestore<Record<string, unknown>>(snapshot.data() ?? {});
      const profile = { ...data } as Partial<UserMemoryProfile>;
      delete (profile as { id?: unknown }).id;
      delete (profile as { userId?: unknown }).userId;
      delete (profile as { updatedAt?: unknown }).updatedAt;
      delete (profile as { serverUpdatedAt?: unknown }).serverUpdatedAt;
      return profile as UserMemoryProfile;
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async saveUserMemoryProfile(userId: string, profile: UserMemoryProfile): Promise<void> {
    try {
      await this.db.collection('users').doc(userId).collection('preferences').doc('profile').set(
        firestoreSafeRecord(this.withServerUpdatedAt({
          id: 'profile',
          userId,
          ...profile,
          updatedAt: new Date().toISOString(),
        })),
        { merge: true },
      );
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async getGoogleIntegrations(userId: string): Promise<GoogleIntegrationState[]> {
    const records = await this.list<GoogleIntegrationState & { id: string; userId: string }>(
      userId,
      'googleIntegrations',
    );
    return records.map(({ id: _id, userId: _userId, ...state }) => state);
  }

  async replaceGoogleIntegrations(userId: string, integrations: GoogleIntegrationState[]): Promise<void> {
    try {
      const collection = this.collection(userId, 'googleIntegrations');
      const existing = await collection.get();
      const batch = this.db.batch();
      existing.docs.forEach((doc) => batch.delete(doc.ref));
      integrations.forEach((integration) => {
        batch.set(collection.doc(integration.name), firestoreSafeRecord(this.withServerUpdatedAt({
          ...integration,
          id: integration.name,
          userId,
        })));
      });
      await batch.commit();
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  async logEvent(userId: string, event: FirestoreEvent): Promise<void> {
    await this.save(userId, 'events', event);
  }

  async resetUserData(userId: string): Promise<void> {
    const collections: CollectionName[] = [
      'contexts',
      'nodes',
      'edges',
      'sources',
      'conversations',
      'feedback',
      'events',
      'memories',
      'askChats',
      'askMessages',
      'askResearch',
      'focusAssessments',
      'projectOverviewAssessments',
      'askSuggestionAssessments',
      'projectSnapshots',
      'developerGenerationRuns',
      'developerGenerationSteps',
      'googleIntegrations',
    ];
    for (const collectionName of collections) {
      const snapshot = await this.collection(userId, collectionName).get();
      for (let start = 0; start < snapshot.docs.length; start += 450) {
        const batch = this.db.batch();
        snapshot.docs.slice(start, start + 450).forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    }
    await this.db.collection('users').doc(userId).collection('preferences').doc('app').delete();
    await this.db.collection('users').doc(userId).collection('preferences').doc('profile').delete();
  }

  async resetDemoData(userId: string): Promise<void> {
    const demo = createGoldenDemoProject();
    await this.saveProject(userId, demo);
    await this.setAppScope(userId, { type: 'project', projectId: demo.id });
  }

  private collection(userId: string, collection: CollectionName) {
    if (!userId.trim()) {
      throw new StorageError('Storage calls require a userId.', 'UNAUTHENTICATED');
    }
    return this.db.collection('users').doc(userId).collection(collection);
  }

  private async list<T extends { userId: string }>(userId: string, collection: CollectionName): Promise<T[]> {
    try {
      const snapshot = await this.collection(userId, collection).get();
      return snapshot.docs.map((doc) => this.fromFirestore<T>(doc.data()));
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  private async save<T extends { id: string; userId: string }>(
    userId: string,
    collection: CollectionName,
    record: T
  ): Promise<void> {
    try {
      await this.collection(userId, collection).doc(record.id).set(
        firestoreSafeRecord(this.withServerUpdatedAt({ ...record, userId })),
        {
          merge: true,
        }
      );
    } catch (error) {
      throw this.toStorageError(error);
    }
  }

  private withServerUpdatedAt<T extends object>(record: T): T & { serverUpdatedAt: FieldValue } {
    return {
      ...record,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    };
  }

  private belongsToProject(
    collection: keyof ProjectCollections,
    docId: string,
    data: FirebaseFirestore.DocumentData,
    projectId: string
  ): boolean {
    if (data.scope === 'global') return false;
    if (data.projectId) return data.projectId === projectId;
    if (collection === 'contexts') return docId === projectId;
    return false;
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

  private fromFirestore<T>(data: FirebaseFirestore.DocumentData): T {
    return JSON.parse(
      JSON.stringify(data, (_key, value) => {
        if (value && typeof value.toDate === 'function') {
          return value.toDate().toISOString();
        }
        return value;
      })
    ) as T;
  }

  private toStorageError(error: unknown): StorageError {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (code.includes('permission-denied')) {
      return new StorageError('Firestore permission denied for this user/project.', 'PERMISSION_DENIED');
    }
    if (code.includes('unauthenticated')) {
      return new StorageError('Firestore request is unauthenticated.', 'UNAUTHENTICATED');
    }
    return new StorageError(
      error instanceof Error ? error.message : 'Firestore is currently unavailable.',
      'UNAVAILABLE'
    );
  }
}
