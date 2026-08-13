import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { AppScope, EVERYTHING_SCOPE } from '@/types/scope';
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
  StorageError,
  StorageProvider,
} from '@/lib/storage/types';

type CollectionName = keyof ProjectCollections | 'feedback' | 'events' | 'memories';

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

export class FirestoreStorageProvider implements StorageProvider {
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

    await Promise.all(
      (Object.keys(collections) as Array<keyof ProjectCollections>).map(async (collection) => {
        const snapshot = await this.collection(userId, collection).get();
        snapshot.docs
          .filter((doc) => this.belongsToProject(collection, doc.id, doc.data(), project.id))
          .forEach((doc) => batch.delete(doc.ref));
        collections[collection].forEach((record) => {
          batch.set(this.collection(userId, collection).doc(record.id), stripUndefined(this.withServerUpdatedAt(record)));
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

  async getSources(userId: string): Promise<FirestoreSource[]> {
    return this.list<FirestoreSource>(userId, 'sources');
  }

  async saveSource(userId: string, source: FirestoreSource): Promise<void> {
    await this.save(userId, 'sources', source);
  }

  async deleteSource(userId: string, sourceId: string): Promise<void> {
    await this.collection(userId, 'sources').doc(sourceId).delete();
  }

  async getConversations(userId: string): Promise<FirestoreConversation[]> {
    return this.list<FirestoreConversation>(userId, 'conversations');
  }

  async saveConversation(userId: string, conversation: FirestoreConversation): Promise<void> {
    await this.save(userId, 'conversations', conversation);
  }

  async getFeedback(userId: string): Promise<FirestoreFeedback[]> {
    return this.list<FirestoreFeedback>(userId, 'feedback');
  }

  async saveFeedback(userId: string, feedback: FirestoreFeedback): Promise<void> {
    await this.save(userId, 'feedback', feedback);
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

  async logEvent(userId: string, event: FirestoreEvent): Promise<void> {
    await this.save(userId, 'events', event);
  }

  async resetDemoData(userId: string): Promise<void> {
    const demo = createGoldenDemoProject();
    await this.saveProject(userId, demo);
    await this.setAppScope(userId, EVERYTHING_SCOPE);
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
        stripUndefined(this.withServerUpdatedAt({ ...record, userId })),
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
    return projectId === createGoldenDemoProject().id;
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
