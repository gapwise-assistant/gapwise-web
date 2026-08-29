import type { ContextPack, DurableMemory } from '@/types/contextPack';
import type {
  ClarityEdge,
  ClarityNode,
  Project,
  ProjectHistoryChange,
  ProjectHistoryEvent,
  UserMemoryProfile,
} from '@/types/clarity';
import type { AppScope } from '@/types/scope';
import type { StorageProvider } from '@/lib/storage/types';
import { getStorageProvider } from '@/lib/storage';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { semanticProjectVersion } from '@/lib/projects/semanticVersion';
import {
  askSuggestionsCurrentCacheId,
} from '@/lib/ask/suggestionsCacheId';
import { askSuggestionsProjectStateVersion } from '@/lib/ask/suggestionsCache';
import {
  focusAssessmentCacheId,
  focusProjectStateVersion,
} from '@/lib/focus/focusCache';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import {
  overviewProjectStateVersion,
  projectOverviewAssessmentCacheId,
} from '@/lib/overview/projectOverviewCache';
import type { ProjectOverviewAssessment } from '@/lib/overview/projectOverviewAssessment';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';
import { publicDemoDailyDemoLimit, publicDemoUsageExpired } from '@/lib/auth/publicDemo';
import { StorageError } from '@/lib/storage/types';
import { nextAvailableProjectTitle } from '@/lib/projects/projectNaming';

export const QUICK_DEMO_TITLE = 'Prepare a neighborhood repair workshop';
export const QUICK_DEMO_GOAL =
  'Organize a practical repair workshop for 20 neighbors with the venue, instructors, tools, registration, and budget confirmed before September 24, 2026.';
export const QUICK_DEMO_DEADLINE = '2026-09-24';

export const QUICK_DEMO_BRIEF = `The neighborhood library has tentatively held its community room for September 24 from 6:00 PM to 8:30 PM, but final approval may depend on whether the workshop requires a certificate of insurance. Two instructors have confirmed that they can lead the session. The available workshop budget is $350. We have 12 repair kits for a planned group of 20 neighbors, so we need to decide whether to borrow or rent the remaining eight kits. Registration is planned to open on September 1.`;

const INSURANCE_QUESTION = 'Does the library require a certificate of insurance for the repair workshop?';
const KIT_DECISION = 'Determine how to provide the remaining eight repair kits for the workshop: borrow them or rent them.';
const VENUE_CONFIRMATION = 'The community room is expected to receive final venue approval once the library\'s insurance requirement is satisfied.';
const LIBRARY_ACTION = 'Ask the library coordinator to confirm the workshop insurance requirements.';

export interface QuickDemoResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  created: boolean;
  snapshotCount: number;
  historyEventCount: number;
  finalNodeCount: number;
  finalEdgeCount: number;
  assessmentStatus: {
    focus: 'ready';
    overview: 'ready';
    askSuggestions: 'ready';
  };
}

const publicQuickDemoLocks = new Map<string, Promise<void>>();

async function withPublicQuickDemoLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const previous = publicQuickDemoLocks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const current = previous.then(() => gate);
  publicQuickDemoLocks.set(userId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (publicQuickDemoLocks.get(userId) === current) publicQuickDemoLocks.delete(userId);
  }
}

function createdAtWithoutIdCollision(
  title: string,
  projects: Project[],
  baseTime = Date.now(),
  expectedProjectId?: string,
): string {
  const ids = new Set(projects.map((project) => project.id));
  let offset = 0;
  while (offset < 10_000) {
    const createdAt = new Date(baseTime + offset).toISOString();
    const candidate = createProjectFromInput({
      name: title,
      goal: QUICK_DEMO_GOAL,
      deadline: QUICK_DEMO_DEADLINE,
    }, createdAt);
    if (!ids.has(candidate.id) || candidate.id === expectedProjectId) return createdAt;
    offset += 1;
  }
  throw new Error('Could not allocate a unique workspace identity for the quick demo.');
}

function node(
  projectId: string,
  key: string,
  type: ClarityNode['type'],
  text: string,
  createdAt: string,
  options: Partial<Pick<ClarityNode, 'status' | 'confidence' | 'impact' | 'source_refs'>> = {},
): ClarityNode {
  return {
    id: `quick_${projectId}_${key}`,
    type,
    text,
    status: options.status ?? 'RESOLVED',
    confidence: options.confidence ?? 0.96,
    impact: options.impact ?? 0.72,
    source_refs: options.source_refs ?? [],
    created_by: 'user',
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function edge(
  projectId: string,
  key: string,
  source: ClarityNode,
  target: ClarityNode,
  type: ClarityEdge['type'],
): ClarityEdge {
  return {
    id: `quick_${projectId}_edge_${key}`,
    source: source.id,
    target: target.id,
    type,
    confidence: 0.94,
  };
}

function historyChange(nodeToRecord: ClarityNode, kind: ProjectHistoryChange['kind'] = 'learned'): ProjectHistoryChange {
  return {
    kind,
    nodeId: nodeToRecord.id,
    text: nodeToRecord.text,
    snapshot: {
      nodeId: nodeToRecord.id,
      text: nodeToRecord.text,
      type: nodeToRecord.type,
      status: nodeToRecord.status,
    },
  };
}

function contextEvent(
  project: Project,
  sourceId: string,
  nodes: ClarityNode[],
  createdAt: string,
): ProjectHistoryEvent {
  return {
    id: `${project.id}:history:workshop_brief:${createdAt}`,
    projectId: project.id,
    createdAt,
    type: 'context_added',
    title: 'Workshop brief added',
    summary: 'Added the venue, instructors, budget, kit inventory, registration plan, and remaining questions.',
    sourceId,
    sourceNodeIds: nodes.map((item) => item.id),
    affectedNodeIds: nodes.map((item) => item.id),
    affectedNodes: nodes.map((item) => ({
      nodeId: item.id,
      text: item.text,
      type: item.type,
      status: item.status,
    })),
    changes: nodes.map((item) => historyChange(item, item.status === 'OPEN' ? 'became_actionable' : 'learned')),
    primaryNodeId: nodes.find((item) => item.id.endsWith('_insurance_question'))?.id,
  };
}

function buildFocusAssessment(
  insuranceQuestion: ClarityNode,
  libraryAction: ClarityNode,
  venueConfirmation: ClarityNode,
  sourceId: string,
): FocusAssessment {
  return {
    kind: 'question',
    title: insuranceQuestion.text,
    nextAction: libraryAction.text,
    whyNow: 'The library’s insurance requirement determines whether the tentatively held room can be finalized.',
    targetNodeId: insuranceQuestion.id,
    executionNodeId: libraryAction.id,
    representedNodeIds: [insuranceQuestion.id, libraryAction.id, venueConfirmation.id],
    sourceNodeIds: [insuranceQuestion.id, venueConfirmation.id],
    sourceIds: [sourceId],
    actionNodeId: insuranceQuestion.id,
    score: 0.98,
    confidence: 0.98,
  };
}

function buildOverviewAssessment(
  historyEventId: string,
  insuranceQuestion: ClarityNode,
  kitDecision: ClarityNode,
  venueConfirmation: ClarityNode,
  budget: ClarityNode,
  instructors: ClarityNode,
  registration: ClarityNode,
): ProjectOverviewAssessment {
  return {
    trajectory: {
      state: 'taking_shape',
      explanation: 'The workshop has a plausible venue, confirmed instructors, and a defined budget, while insurance and the remaining kits are still unsettled.',
    },
    summary: 'The workshop is taking shape around a tentatively held library room, two confirmed instructors, and a $350 budget. The main operational path is clear, but venue approval still depends on the library’s insurance requirement and eight repair kits remain to be sourced. Registration can be prepared for September 1 once those constraints are understood.',
    meaningfulChanges: [{
      title: 'A workable workshop plan is defined',
      whatChanged: 'The brief established the venue window, instructors, budget, kit gap, and registration timing.',
      consequence: 'The project can move into targeted confirmation and kit planning instead of broad setup.',
      sourceNodeIds: [venueConfirmation.id, budget.id, instructors.id, kitDecision.id],
      historyEventIds: [historyEventId],
    }],
    goalImpact: {
      summary: 'The project is clearer and more executable, with two remaining uncertainties that could affect venue readiness and supply cost.',
      positiveFactors: [
        { text: 'Two instructors are already confirmed for the session.', sourceNodeIds: [instructors.id] },
        { text: 'A room, date, time window, and registration target are available to plan around.', sourceNodeIds: [venueConfirmation.id, registration.id] },
      ],
      negativeFactors: [
        { text: 'Insurance requirements could prevent final venue approval.', sourceNodeIds: [insuranceQuestion.id, venueConfirmation.id] },
        { text: 'Sourcing eight additional kits may put pressure on the $350 budget.', sourceNodeIds: [kitDecision.id, budget.id] },
      ],
    },
    unsettled: [
      {
        title: insuranceQuestion.text,
        explanation: 'The answer determines whether the tentatively held library room can move to final approval.',
        sourceNodeIds: [insuranceQuestion.id, venueConfirmation.id],
      },
      {
        title: kitDecision.text,
        explanation: 'The choice between borrowing and renting eight kits determines the remaining supply plan and its budget impact.',
        sourceNodeIds: [kitDecision.id, budget.id],
      },
    ],
    criticalIssues: [{
      severity: 'medium',
      title: 'Venue approval is not final',
      explanation: 'The community room is tentatively held, but the insurance requirement is still unknown.',
      sourceNodeIds: [insuranceQuestion.id, venueConfirmation.id],
    }],
    emergingInsights: [{
      text: 'The workshop is operationally close to ready, but external approval and supply coverage are now the constraints that shape the remaining work.',
      explanation: 'The venue hold, confirmed instructors, budget, and kit shortfall point to a narrow set of remaining dependencies.',
      sourceNodeIds: [venueConfirmation.id, instructors.id, budget.id, kitDecision.id],
    }],
    confidence: 0.95,
  };
}

function projectContextPack(project: Project, profile: UserMemoryProfile, memories: DurableMemory[]): ContextPack {
  return buildContextPack({
    userId: 'quick-demo',
    query: 'What is the current strategic state of this workshop?',
    project,
    profile,
    durableMemories: memories,
    calendarCommitments: [],
    conversationMessages: [],
    researchEvidence: [],
    includeBroadContext: true,
    scope: { type: 'project', projectId: project.id },
  });
}

async function persistAssessments(
  storage: StorageProvider,
  userId: string,
  project: Project,
  profile: UserMemoryProfile,
  memories: DurableMemory[],
  sourceId: string,
  historyEventId: string,
  insuranceQuestion: ClarityNode,
  kitDecision: ClarityNode,
  venueConfirmation: ClarityNode,
  budget: ClarityNode,
  instructors: ClarityNode,
  libraryAction: ClarityNode,
  registration: ClarityNode,
): Promise<void> {
  const contextPack = projectContextPack(project, profile, memories);
  const focus = buildFocusAssessment(insuranceQuestion, libraryAction, venueConfirmation, sourceId);
  const focusVersion = await focusProjectStateVersion(project, contextPack, profile);
  const now = new Date().toISOString();
  await storage.saveFocusAssessment(userId, {
    id: focusAssessmentCacheId(project.id, focusVersion),
    userId,
    projectId: project.id,
    projectStateVersion: focusVersion,
    assessment: focus,
    createdAt: now,
    updatedAt: now,
  });

  const overviewVersion = await overviewProjectStateVersion(
    project,
    project.historyEvents ?? [],
    focus,
    contextPack,
    profile,
  );
  const overview = buildOverviewAssessment(
    historyEventId,
    insuranceQuestion,
    kitDecision,
    venueConfirmation,
    budget,
    instructors,
    registration,
  );
  await storage.saveProjectOverviewAssessment(userId, {
    id: projectOverviewAssessmentCacheId(project.id, overviewVersion),
    userId,
    projectId: project.id,
    projectStateVersion: overviewVersion,
    assessment: overview,
    createdAt: now,
    updatedAt: now,
  });

  const suggestionVersion = await askSuggestionsProjectStateVersion(project, profile, memories);
  const projectVersion = semanticProjectVersion(project);
  await storage.saveAskSuggestionsCache(userId, {
    id: askSuggestionsCurrentCacheId(project.id),
    userId,
    projectId: project.id,
    scopeKey: project.id,
    projectStateVersion: suggestionVersion,
    semanticProjectVersion: projectVersion,
    requestedSemanticProjectVersion: projectVersion,
    publishedInputVersion: suggestionVersion,
    topQuestions: [
      'What should I confirm with the library before finalizing the venue?',
      'How should I cover the eight missing repair kits within the current budget?',
      'What could delay opening workshop registration?',
    ],
    otherQuestions: [],
    generatedBy: 'quick-demo-deterministic',
    createdAt: now,
    updatedAt: now,
    generatedAt: now,
    status: 'ready',
  });
}

export async function createQuickDemoForUser(params: {
  userId: string;
  storage?: StorageProvider;
  now?: Date;
  titleOverride?: string;
  expectedProjectId?: string;
}): Promise<QuickDemoResult> {
  const storage = params.storage ?? getStorageProvider();
  const projects = await storage.listProjects(params.userId);
  const expectedProject = params.expectedProjectId
    ? projects.find((project) => project.id === params.expectedProjectId)
    : undefined;
  const title = expectedProject?.title
    ?? nextAvailableProjectTitle(params.titleOverride ?? QUICK_DEMO_TITLE, projects);
  const createdAt = createdAtWithoutIdCollision(
    title,
    projects,
    params.now?.getTime(),
    params.expectedProjectId,
  );
  let project = createProjectFromInput({
    name: title,
    goal: QUICK_DEMO_GOAL,
    description: 'A small deterministic workshop scenario for exploring venue approval, supplies, and launch readiness.',
    deadline: QUICK_DEMO_DEADLINE,
  }, createdAt);

  await storage.saveProject(params.userId, project);
  await createProjectSnapshot({
    userId: params.userId,
    projectId: project.id,
    trigger: {
      type: 'project_created',
      historyEventId: project.historyEvents?.[0]?.id,
    },
    label: 'Project started',
    summary: 'Created the workshop workspace with its initial goal.',
  });

  const briefAt = new Date(Date.parse(createdAt) + 1).toISOString();
  const sourceId = `${project.id}:source:workshop-brief`;
  const sourceRefs = [sourceId];
  const insuranceQuestion = node(project.id, 'insurance_question', 'UNKNOWN', INSURANCE_QUESTION, briefAt, { status: 'OPEN', impact: 0.98, source_refs: sourceRefs });
  const kitDecision = node(project.id, 'kit_decision', 'DECISION', KIT_DECISION, briefAt, { status: 'OPEN', impact: 0.88, source_refs: sourceRefs });
  const venueConfirmation = node(project.id, 'venue_confirmation', 'ASSUMPTION', VENUE_CONFIRMATION, briefAt, { status: 'OPEN', impact: 0.86, source_refs: sourceRefs });
  const libraryAction = node(project.id, 'library_action', 'NEXT_ACTION', LIBRARY_ACTION, briefAt, { status: 'OPEN', impact: 0.95, source_refs: sourceRefs });
  const venueHold = node(project.id, 'venue_hold', 'KNOWN', 'The neighborhood library has tentatively held the community room for September 24 from 6:00 PM to 8:30 PM.', briefAt, { source_refs: sourceRefs });
  const instructors = node(project.id, 'instructors', 'KNOWN', 'Two instructors have confirmed that they can lead the workshop.', briefAt, { source_refs: sourceRefs });
  const budget = node(project.id, 'budget', 'CONSTRAINT', 'The available budget for the workshop is $350.', briefAt, { impact: 0.84, source_refs: sourceRefs });
  const kits = node(project.id, 'kits', 'KNOWN', 'There are 12 repair kits for a planned group of 20 neighbors, leaving eight kits to source.', briefAt, { source_refs: sourceRefs });
  const registration = node(project.id, 'registration', 'KNOWN', 'Workshop registration is planned to open on September 1, 2026.', briefAt, { source_refs: sourceRefs });
  const extractedNodes = [insuranceQuestion, kitDecision, venueConfirmation, libraryAction, venueHold, instructors, budget, kits, registration];
  const edges = [
    edge(project.id, 'insurance-informs-venue', insuranceQuestion, venueConfirmation, 'informs'),
    edge(project.id, 'library-action-satisfies-insurance', libraryAction, insuranceQuestion, 'satisfies'),
    edge(project.id, 'venue-hold-supports-venue', venueHold, venueConfirmation, 'supports'),
    edge(project.id, 'instructors-support-goal', instructors, project.nodes[0], 'supports'),
    edge(project.id, 'budget-affects-kits', budget, kitDecision, 'affects'),
    edge(project.id, 'kits-informs-decision', kits, kitDecision, 'informs'),
    edge(project.id, 'registration-affects-goal', registration, project.nodes[0], 'affects'),
    edge(project.id, 'kits-decision-affects-goal', kitDecision, project.nodes[0], 'affects'),
    edge(project.id, 'venue-confirmation-affects-goal', venueConfirmation, project.nodes[0], 'affects'),
  ];
  const source = {
    id: sourceId,
    filename: 'Neighborhood repair workshop brief',
    type: 'note' as const,
    content: QUICK_DEMO_BRIEF,
    extracted_at: briefAt,
    derived_node_ids: extractedNodes.map((item) => item.id),
    processing_status: 'completed' as const,
    processed_at: briefAt,
    origin: 'user' as const,
    extraction_summary: 'Venue, instructors, budget, repair-kit inventory, insurance question, and registration timing.',
    semantic_contribution: true,
  };
  const event = contextEvent(project, sourceId, extractedNodes, briefAt);
  project = {
    ...project,
    nodes: [...project.nodes, ...extractedNodes],
    edges: [...project.edges, ...edges],
    sources: [...project.sources, source],
    historyEvents: [...(project.historyEvents ?? []), event],
    updated_at: briefAt,
  };
  await storage.saveProject(params.userId, project);

  const profile = await storage.getUserMemoryProfile(params.userId) ?? DEFAULT_USER_PROFILE;
  const memories = await storage.getMemories(params.userId);
  await persistAssessments(
    storage,
    params.userId,
    project,
    profile,
    memories,
    sourceId,
    event.id,
    insuranceQuestion,
    kitDecision,
    venueConfirmation,
    budget,
    instructors,
    libraryAction,
    registration,
  );
  await createProjectSnapshot({
    userId: params.userId,
    projectId: project.id,
    trigger: {
      type: 'context_processed',
      sourceId,
      historyEventId: event.id,
    },
    label: 'Workshop brief added',
    summary: 'The workshop brief established the first venue, staffing, budget, supply, and registration picture.',
  });

  await storage.setAppScope(params.userId, { type: 'project', projectId: project.id });
  const finalProjects = await storage.listProjects(params.userId);
  return {
    project,
    projects: finalProjects,
    activeProjectId: project.id,
    scope: { type: 'project', projectId: project.id },
    created: true,
    snapshotCount: (await storage.listProjectSnapshots(params.userId, project.id)).length,
    historyEventCount: project.historyEvents?.length ?? 0,
    finalNodeCount: project.nodes.length,
    finalEdgeCount: project.edges.length,
    assessmentStatus: {
      focus: 'ready',
      overview: 'ready',
      askSuggestions: 'ready',
    },
  };
}

/**
 * Public users get one stable Quick Demo workspace. The usage record is the
 * authority for which workspace is exposed, so unrelated historical projects
 * can never leak into the public-demo list.
 */
export async function createOrReuseQuickDemoForUser(params: {
  userId: string;
  storage?: StorageProvider;
}): Promise<QuickDemoResult> {
  return withPublicQuickDemoLock(params.userId, () => createOrReuseQuickDemoForUserUnlocked(params));
}

async function createOrReuseQuickDemoForUserUnlocked(params: {
  userId: string;
  storage?: StorageProvider;
}): Promise<QuickDemoResult> {
  const storage = params.storage ?? getStorageProvider();
  const usage = await storage.getPublicDemoUsage(params.userId);
  if (publicDemoUsageExpired(usage)) {
    throw new StorageError('The public demo workspace is no longer available.', 'UNAVAILABLE');
  }
  const registeredProjectId = usage?.quickDemoProjectId;
  const existing = registeredProjectId
    ? await storage.getProject(params.userId, registeredProjectId)
    : null;

  if (existing && usage?.quickDemoStatus !== 'failed' && usage?.quickDemoStatus !== 'creating') {
    await storage.setAppScope(params.userId, { type: 'project', projectId: existing.id });
    return {
      project: existing,
      projects: [existing],
      activeProjectId: existing.id,
      scope: { type: 'project', projectId: existing.id },
      created: false,
      snapshotCount: (await storage.listProjectSnapshots(params.userId, existing.id)).length,
      historyEventCount: existing.historyEvents?.length ?? 0,
      finalNodeCount: existing.nodes.length,
      finalEdgeCount: existing.edges.length,
      assessmentStatus: { focus: 'ready', overview: 'ready', askSuggestions: 'ready' },
    };
  }

  if (usage?.quickDemoStatus === 'creating') {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const currentUsage = await storage.getPublicDemoUsage(params.userId);
      const currentProject = currentUsage?.quickDemoProjectId
        ? await storage.getProject(params.userId, currentUsage.quickDemoProjectId)
        : null;
      if (currentProject && currentUsage && currentUsage.quickDemoStatus !== 'creating') {
        if (currentUsage.quickDemoStatus === 'failed') break;
        await storage.setAppScope(params.userId, { type: 'project', projectId: currentProject.id });
        return {
          project: currentProject,
          projects: [currentProject],
          activeProjectId: currentProject.id,
          scope: { type: 'project', projectId: currentProject.id },
          created: false,
          snapshotCount: (await storage.listProjectSnapshots(params.userId, currentProject.id)).length,
          historyEventCount: currentProject.historyEvents?.length ?? 0,
          finalNodeCount: currentProject.nodes.length,
          finalEdgeCount: currentProject.edges.length,
          assessmentStatus: { focus: 'ready', overview: 'ready', askSuggestions: 'ready' },
        };
      }
    }
    const currentUsage = await storage.getPublicDemoUsage(params.userId);
    if (currentUsage?.quickDemoStatus !== 'failed') {
      throw new StorageError('The public demo workspace is still being prepared.', 'UNAVAILABLE');
    }
  }

  const reservedCreatedAt = usage?.quickDemoCreatedAt ?? new Date().toISOString();
  const existingProjects = await storage.listProjects(params.userId);
  const registeredProject = registeredProjectId
    ? existingProjects.find((project) => project.id === registeredProjectId)
    : undefined;
  const reservedTitle = registeredProject?.title
    ?? nextAvailableProjectTitle(QUICK_DEMO_TITLE, existingProjects);
  const reservationProject = createProjectFromInput({
    name: reservedTitle,
    goal: QUICK_DEMO_GOAL,
    deadline: QUICK_DEMO_DEADLINE,
  }, reservedCreatedAt);
  if (registeredProjectId && reservationProject.id !== registeredProjectId) {
    throw new StorageError('The registered public demo workspace identity is invalid.', 'VALIDATION_ERROR');
  }
  const claim = await storage.reservePublicDemoQuickDemo({
    userId: params.userId,
    projectId: reservationProject.id,
    createdAt: reservedCreatedAt,
    dailyLimit: publicDemoDailyDemoLimit(),
  });
  if (!claim.claimed) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const claimedProject = await storage.getProject(params.userId, claim.projectId);
      if (claimedProject) {
        await storage.setAppScope(params.userId, { type: 'project', projectId: claimedProject.id });
        return {
          project: claimedProject,
          projects: [claimedProject],
          activeProjectId: claimedProject.id,
          scope: { type: 'project', projectId: claimedProject.id },
          created: false,
          snapshotCount: (await storage.listProjectSnapshots(params.userId, claimedProject.id)).length,
          historyEventCount: claimedProject.historyEvents?.length ?? 0,
          finalNodeCount: claimedProject.nodes.length,
          finalEdgeCount: claimedProject.edges.length,
          assessmentStatus: { focus: 'ready', overview: 'ready', askSuggestions: 'ready' },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new StorageError('The public demo workspace is still being prepared.', 'UNAVAILABLE');
  }

  try {
    const result = await createQuickDemoForUser({
      userId: params.userId,
      storage,
      titleOverride: reservedTitle,
      now: new Date(claim.createdAt),
      expectedProjectId: claim.projectId,
    });
    await storage.setPublicDemoQuickDemoStatus({
      userId: params.userId,
      projectId: claim.projectId,
      status: 'ready',
    });
    return { ...result, projects: [result.project] };
  } catch (error) {
    try {
      await storage.setPublicDemoQuickDemoStatus({
        userId: params.userId,
        projectId: claim.projectId,
        status: 'failed',
      });
    } catch (statusError) {
      console.error('[Public Quick Demo] failed to record creation status', statusError);
    }
    throw error;
  }
}
