import { uploadContextSourcePdf } from '@/lib/storage/gcsAssets';
import { getStorageProvider } from '@/lib/storage';
import type { StorageProvider } from '@/lib/storage/types';
import type {
  ClarityEdge,
  ClarityNode,
  ContextSource,
  Project,
  ProjectHistoryChange,
  ProjectHistoryEvent,
  UserMemoryProfile,
} from '@/types/clarity';
import type { AskChatMessage, AskChatSession, AskContextProposal } from '@/types/ask';
import type { AppScope } from '@/types/scope';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import type { ProjectOverviewAssessment } from '@/lib/overview/projectOverviewAssessment';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { nextAvailableProjectTitle } from '@/lib/projects/projectNaming';
import { boundedId } from '@/lib/ids/boundedId';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { focusAssessmentCacheId, focusProjectStateVersion } from '@/lib/focus/focusCache';
import { overviewProjectStateVersion, projectOverviewAssessmentCacheId } from '@/lib/overview/projectOverviewCache';
import { askSuggestionsCurrentCacheId } from '@/lib/ask/suggestionsCacheId';
import { askSuggestionsProjectStateVersion } from '@/lib/ask/suggestionsCache';
import { semanticProjectVersion } from '@/lib/projects/semanticVersion';
import { startDeveloperGenerationRun } from '@/lib/observability/developerGeneration';
import { recordTrace } from '@/lib/observability/trace';

export const SOFTWARE_RELEASE_DEMO_TITLE = 'RelayDesk Offline Sync Release';
export const SOFTWARE_RELEASE_DEMO_GOAL =
  'Release reliable offline work-order synchronization by September 18, 2026, without creating duplicate work orders or losing technician updates when connectivity returns.';
export const SOFTWARE_RELEASE_DEMO_DEADLINE = '2026-09-18';

const SOFTWARE_RELEASE_DESCRIPTION =
  'RelayDesk is a field-service application used by technicians in locations with unreliable connectivity. Technicians create work orders offline, add notes and photographs, change job status, collect signatures, and synchronize changes when connectivity returns. The initial queue is in place, but retry behavior and Safari reliability are not ready for production.';

export interface SoftwareReleaseDemoResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  created: true;
  generationRunId: string;
  snapshotCount: number;
  historyEventCount: number;
  finalNodeCount: number;
  finalEdgeCount: number;
  sourceCount: number;
  chatCount: number;
  messageCount: number;
  proposalCount: number;
  aiCalls: 0;
  execution: 'simulated';
  assessments: { focus: 'ready'; overview: 'ready'; today: 'ready'; askSuggestions: 'ready' };
}

const generationLocks = new Map<string, Promise<SoftwareReleaseDemoResult>>();

type DemoNodeKey =
  | 'technicians' | 'connectivity' | 'beta' | 'production' | 'release'
  | 'indexeddb' | 'ambiguous' | 'retryCode' | 'duplicateEvidence' | 'duplicateRisk'
  | 'operationUuid' | 'idempotency' | 'retryQuestion' | 'safariQuestion'
  | 'dashboardQuestion' | 'monitoring' | 'engineers' | 'tokenConstraint'
  | 'backwardCompatibility' | 'timeoutAction' | 'safariAction' | 'metricsAction'
  | 'featureFlagAction';

type DemoSourceKey = 'brief' | 'architecture' | 'worker' | 'timeout' | 'safari' | 'security' | 'readiness';

interface SourceDefinition {
  key: DemoSourceKey;
  filename: string;
  type: ContextSource['type'];
  content: string;
  title: string;
}

interface NodeDefinition {
  key: DemoNodeKey;
  type: ClarityNode['type'];
  text: string;
  sourceKeys: DemoSourceKey[];
  status?: ClarityNode['status'];
  impact?: number;
  why?: string;
}

const sourceDefinitions: SourceDefinition[] = [
  {
    key: 'brief',
    filename: 'RelayDesk Offline Sync Product Brief.pdf',
    type: 'pdf',
    title: 'RelayDesk Offline Sync Product Brief',
    content: [
      'RelayDesk Offline Sync Product Brief', '',
      'Prepared: August 25, 2026 | Owner: Priya Nair, Product Operations',
      'Decision review: August 29, 2026', '',
      'Success measure                         Target',
      'Duplicate mutations                    < 0.1%',
      'Unrecoverable queued updates           0',
      'Beta population                         42 technicians / 3 regions', '',
      'Release target: September 18, 2026',
      'Beta rollout: September 12, 2026', '',
      'RelayDesk supports 42 beta technicians across three service regions.',
      'Technicians create work orders while offline, add notes and photographs, change job status,',
      'collect customer signatures, and synchronize changes when connectivity returns.',
      'About 28% of beta sessions experience at least one connectivity interruption.', '',
      'Release success means fewer than 0.1% duplicate mutations and no unrecoverable queued updates.',
      'The team may use a feature flag if the release decision requires a narrower rollout.',
    ].join('\n'),
  },
  {
    key: 'architecture',
    filename: 'offline-sync-architecture.md',
    type: 'text',
    title: 'Offline sync architecture',
    content: [
      'Offline synchronization architecture', '',
      'UI mutation -> IndexedDB queue -> service worker / sync coordinator -> API -> server transaction',
      '-> acknowledgement -> remove local queue entry.', '',
      'A missing response is ambiguous: the server may have committed the work order even though',
      'the client did not receive the acknowledgement. The browser queue must survive page reloads',
      'and retain structured mutation records.',
      'The staging API accepts an X-Operation-ID header so retries can reuse one request identity.',
      'Existing online work-order behavior must remain backward compatible after offline sync ships.',
    ].join('\n'),
  },
  {
    key: 'worker',
    filename: 'syncWorker.ts',
    type: 'text',
    title: 'syncWorker.ts',
    content: [
      '// Existing sync worker excerpt',
      "for (const mutation of pendingMutations) {",
      "  await api.post('/work-orders', mutation.payload);",
      '  await queue.remove(mutation.localId);',
      '}', '',
      '// The original retry path can send a new request identity after a timeout.',
      '// A stable operation identity is needed so the server can return the original result.',
    ].join('\n'),
  },
  {
    key: 'timeout',
    filename: 'offline-sync-timeout-test.txt',
    type: 'text',
    title: 'Offline sync timeout test',
    content: [
      'offline-sync.spec.ts', 'Test run: RS-2026-08-21-1042',
      'Expected server work-order count: 1',
      'Received server work-order count: 2', '',
      'Scenario:', '1. Client submits one mutation.', '2. Server commits the work order.',
      '3. The response is interrupted.', '4. Client retries after the timeout.',
      '5. Server creates a second work order.',
    ].join('\n'),
  },
  {
    key: 'safari',
    filename: 'Safari Offline Queue Compatibility Report.pdf',
    type: 'pdf',
    title: 'Safari Offline Queue Compatibility Report',
    content: [
      'Safari Offline Queue Compatibility Report', '',
      'Report date: August 27, 2026 | From: Leah Ortiz, Quality Engineering',
      'Browser                  Background resume result',
      'Chrome                   Passed',
      'Edge                     Passed',
      'Safari                   Inconclusive', '',
      'Chrome and Edge recovery tests passed. Safari background suspension remains inconclusive.',
      'One test produced TransactionInactiveError after the application resumed.',
      'The issue has not been confirmed as data loss.',
      'A background-and-resume verification is still required.',
    ].join('\n'),
  },
  {
    key: 'security',
    filename: 'Offline Data Security Review.pdf',
    type: 'pdf',
    title: 'Offline Data Security Review',
    content: [
      'Offline Data Security Review', '',
      'Review date: August 28, 2026 | Reviewer: Omar Haddad, Security Engineering',
      'Control                                  Requirement',
      'Local work-order metadata               Allowed',
      'Authentication tokens                   Never store in IndexedDB',
      'Cached customer signatures              Remove after sync',
      'Server idempotency records              Retain operation IDs for seven days', '',
      'Work-order metadata may be stored locally.',
      'Authentication tokens must not be stored in IndexedDB.',
      'Cached customer signatures must be removed after confirmed synchronization.',
      'Server idempotency records may retain operation IDs for seven days.', '',
      'Security review status: approved with these constraints.',
    ].join('\n'),
  },
  {
    key: 'readiness',
    filename: 'Release Readiness Notes.md',
    type: 'text',
    title: 'Release readiness notes',
    content: [
      'Release readiness notes', '',
      'Two engineers are available before beta. A feature flag already exists.',
      'The monitoring dashboard lacks duplicate-rate alerting and does not yet distinguish delayed',
      'mutations from permanently failed mutations.',
      'The release decision remains open.',
    ].join('\n'),
  },
];

const nodeDefinitions: NodeDefinition[] = [
  { key: 'technicians', type: 'KNOWN', text: 'RelayDesk has 42 beta technicians across three service regions.', sourceKeys: ['brief'], impact: 0.58 },
  { key: 'connectivity', type: 'EVIDENCE', text: 'About 28% of beta sessions experience at least one connectivity interruption.', sourceKeys: ['brief'], impact: 0.78 },
  { key: 'beta', type: 'CONSTRAINT', text: 'The beta rollout is scheduled for September 12, 2026.', sourceKeys: ['brief'], status: 'RESOLVED', impact: 0.86 },
  { key: 'production', type: 'CONSTRAINT', text: 'The production release target is September 18, 2026.', sourceKeys: ['brief'], status: 'RESOLVED', impact: 0.92 },
  { key: 'release', type: 'DECISION', text: 'Choose whether to launch offline sync broadly, release it behind a feature flag, or delay the production release.', sourceKeys: ['brief'], impact: 0.97, why: 'The release mode determines how much exposure the unresolved retry and Safari behavior receives.' },
  { key: 'indexeddb', type: 'DECISION', text: 'Choose the browser storage for persisted offline mutations.', sourceKeys: ['architecture'], impact: 0.76, why: 'The queue must survive reloads while respecting the local-storage security boundary.' },
  { key: 'ambiguous', type: 'EVIDENCE', text: 'A missing server response is ambiguous because the server may have committed the work order already.', sourceKeys: ['architecture'], impact: 0.82 },
  { key: 'retryCode', type: 'EVIDENCE', text: 'The original sync worker can issue a new request identity after a timeout retry.', sourceKeys: ['worker'], impact: 0.84 },
  { key: 'duplicateEvidence', type: 'EVIDENCE', text: 'The timeout test created two server records from one offline mutation.', sourceKeys: ['timeout'], impact: 0.95 },
  { key: 'duplicateRisk', type: 'RISK', text: 'A timed-out request may have committed successfully even though the client retries it, creating a duplicate work order.', sourceKeys: ['timeout', 'worker'], impact: 0.98, why: 'Duplicate work orders would violate the release success criteria and affect customer data.' },
  { key: 'operationUuid', type: 'KNOWN', text: 'The staging API already accepts an X-Operation-ID header.', sourceKeys: ['architecture'], impact: 0.77 },
  { key: 'idempotency', type: 'DECISION', text: 'Use a client-generated operation UUID and a server-side idempotency record for every mutating request.', sourceKeys: ['architecture'], impact: 0.96, why: 'A stable identity lets the server return the original result when a retry follows an interrupted response.' },
  { key: 'retryQuestion', type: 'UNKNOWN', text: 'Can the idempotency implementation keep duplicate work-order creation below 0.1% during timeout retries?', sourceKeys: ['timeout', 'brief'], impact: 1, why: 'The release decision is blocked until the duplicate-prevention strategy is measured against the stated threshold.' },
  { key: 'safariQuestion', type: 'UNKNOWN', text: 'Does Safari preserve and resume queued mutations correctly after the application is suspended in the background?', sourceKeys: ['safari'], impact: 0.9, why: 'Safari behavior could determine whether queued updates are safe for the beta rollout.' },
  { key: 'dashboardQuestion', type: 'UNKNOWN', text: 'Will the synchronization dashboard distinguish a delayed mutation from a permanently failed mutation?', sourceKeys: ['readiness'], impact: 0.74 },
  { key: 'monitoring', type: 'DECISION', text: 'Choose the alert threshold and automatic rollback condition for duplicate or failed synchronization.', sourceKeys: ['readiness'], impact: 0.84 },
  { key: 'engineers', type: 'CONSTRAINT', text: 'Only two engineers are available before the beta rollout.', sourceKeys: ['readiness'], impact: 0.8 },
  { key: 'tokenConstraint', type: 'CONSTRAINT', text: 'Authentication tokens must not be persisted in IndexedDB.', sourceKeys: ['security'], status: 'RESOLVED', impact: 0.9 },
  { key: 'backwardCompatibility', type: 'CONSTRAINT', text: 'Existing online work-order behavior must remain backward compatible.', sourceKeys: ['architecture'], impact: 0.84 },
  { key: 'timeoutAction', type: 'NEXT_ACTION', text: 'Run the 100-request timeout-retry test using the new idempotency key and record the duplicate rate.', sourceKeys: ['timeout'], impact: 0.98, why: 'This is the concrete evidence needed to answer the retry-verification question.' },
  { key: 'safariAction', type: 'NEXT_ACTION', text: 'Run Safari background-and-resume verification for queued mutations.', sourceKeys: ['safari'], impact: 0.86 },
  { key: 'metricsAction', type: 'NEXT_ACTION', text: 'Add duplicate-rate and permanent-failure metrics to the synchronization dashboard.', sourceKeys: ['readiness'], impact: 0.78 },
  { key: 'featureFlagAction', type: 'NEXT_ACTION', text: 'Prepare a feature-flag rollout plan for the offline sync release.', sourceKeys: ['brief', 'readiness'], impact: 0.72 },
];

function pdfEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
}

function pdfBytes(document: SourceDefinition): Buffer {
  const lines = document.content.split(/\r?\n/).flatMap((line) => {
    if (!line) return [''];
    const chunks: string[] = [];
    for (let index = 0; index < line.length; index += 88) chunks.push(line.slice(index, index + 88));
    return chunks;
  });
  const textCommands = ['BT', '/F1 10 Tf', '50 760 Td', ...lines.slice(0, 54).flatMap((line, index) => [index ? '0 -14 Td' : '', '(' + pdfEscape(line) + ') Tj']), 'ET'].filter(Boolean).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + Buffer.byteLength(textCommands, 'ascii') + ' >>\nstream\n' + textCommands + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n%RelayDesk deterministic fixture\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(output, 'ascii');
    output += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  });
  const xref = Buffer.byteLength(output, 'ascii');
  output += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n'
    + offsets.slice(1).map((offset) => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')
    + '\ntrailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(output, 'ascii');
}

function createdAtWithoutCollision(title: string, goal: string, projects: Project[], baseTime: number): string {
  const existingIds = new Set(projects.map((project) => project.id));
  for (let offset = 0; offset < 10000; offset += 1) {
    const createdAt = new Date(baseTime + offset).toISOString();
    const candidate = createProjectFromInput({ name: title, goal }, createdAt);
    if (!existingIds.has(candidate.id)) return createdAt;
  }
  throw new Error('Could not allocate a unique RelayDesk demo workspace identity.');
}

function nodeId(projectId: string, key: DemoNodeKey): string {
  return boundedId('relaydesk_node', projectId + ':' + key);
}

function sourceId(projectId: string, key: DemoSourceKey): string {
  return boundedId('relaydesk_source', projectId + ':' + key);
}

function chatId(projectId: string, key: string): string {
  return boundedId('relaydesk_chat', projectId + ':' + key);
}

function messageId(projectId: string, key: string): string {
  return boundedId('relaydesk_message', projectId + ':' + key);
}

function proposalId(projectId: string, message: string, key: string): string {
  return boundedId('relaydesk_proposal', projectId + ':' + message + ':' + key);
}

function makeNode(projectId: string, definition: NodeDefinition, sources: Map<DemoSourceKey, ContextSource>, timestamp: string): ClarityNode {
  return {
    id: nodeId(projectId, definition.key),
    type: definition.type,
    text: definition.text,
    status: definition.status ?? (definition.type === 'DECISION' || definition.type === 'UNKNOWN' || definition.type === 'RISK' || definition.type === 'NEXT_ACTION' ? 'OPEN' : 'RESOLVED'),
    confidence: definition.type === 'UNKNOWN' || definition.type === 'RISK' ? 0.88 : 0.96,
    impact: definition.impact ?? 0.7,
    source_refs: definition.sourceKeys.map((key) => sources.get(key)!.id),
    why_it_matters: definition.why ? [definition.why] : undefined,
    created_by: 'user',
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function makeEdge(projectId: string, key: string, source: ClarityNode, target: ClarityNode, type: ClarityEdge['type']): ClarityEdge {
  return { id: boundedId('relaydesk_edge', projectId + ':' + key), source: source.id, target: target.id, type, confidence: 0.94 };
}

function historyChange(node: ClarityNode): ProjectHistoryChange {
  return { kind: 'learned', nodeId: node.id, text: node.text, snapshot: { nodeId: node.id, text: node.text, type: node.type, status: node.status } };
}

function makeEvent(project: Project, key: string, createdAt: string, title: string, summary: string, changes: ClarityNode[], options: Partial<Pick<ProjectHistoryEvent, 'type' | 'sourceId' | 'sourceNodeIds' | 'primaryNodeId'>> = {}): ProjectHistoryEvent {
  return {
    id: boundedId('relaydesk_history', project.id + ':' + key),
    projectId: project.id,
    createdAt,
    type: options.type ?? 'context_added',
    title,
    summary,
    ...(options.sourceId ? { sourceId: options.sourceId } : {}),
    ...(options.sourceNodeIds ? { sourceNodeIds: options.sourceNodeIds } : {}),
    ...(options.primaryNodeId ? { primaryNodeId: options.primaryNodeId } : {}),
    affectedNodeIds: changes.map((node) => node.id),
    affectedNodes: changes.map((node) => ({ nodeId: node.id, text: node.text, type: node.type, status: node.status })),
    changes: changes.map(historyChange),
  };
}

function makeFocus(project: Project, sources: Map<DemoSourceKey, ContextSource>): FocusAssessment | null {
  const target = project.nodes.find((node) => node.id === nodeId(project.id, 'retryQuestion'));
  const action = project.nodes.find((node) => node.id === nodeId(project.id, 'timeoutAction'));
  const risk = project.nodes.find((node) => node.id === nodeId(project.id, 'duplicateRisk'));
  const evidence = project.nodes.find((node) => node.id === nodeId(project.id, 'duplicateEvidence'));
  if (!target || !action || !risk || !evidence) return null;
  return {
    kind: 'question',
    title: target.text,
    nextAction: action.text,
    whyNow: 'The release strategy is blocked until the team proves that a committed request cannot create a duplicate when the client retries after losing the response.',
    targetNodeId: target.id,
    executionNodeId: action.id,
    representedNodeIds: [target.id, action.id, risk.id, evidence.id],
    sourceNodeIds: [target.id, risk.id, evidence.id],
    sourceIds: [sources.get('timeout')!.id, sources.get('worker')!.id],
    actionNodeId: target.id,
    score: 0.99,
    confidence: 0.96,
  };
}

function makeOverview(project: Project): ProjectOverviewAssessment {
  const open = project.nodes.filter((node) => node.status === 'OPEN' && ['DECISION', 'UNKNOWN', 'ASSUMPTION', 'RISK'].includes(node.type));
  const resolved = project.nodes.filter((node) => node.status === 'RESOLVED' && node.type === 'DECISION');
  const recentEvent = project.historyEvents?.at(-1);
  const validIds = new Set(project.nodes.map((node) => node.id));
  const sourceIds = (ids: string[]) => ids.filter((id) => validIds.has(id));
  return {
    trajectory: { state: 'at_risk', explanation: 'The core queue and idempotency direction is settled, but timeout verification, Safari recovery, monitoring, and release strategy remain open.' },
    summary: 'RelayDesk is preparing offline work-order synchronization for a September 18 release. The team has selected IndexedDB for the browser queue and a stable operation UUID with server-side idempotency for duplicate prevention. A timeout test reproduced duplicate creation, so the new strategy still needs measurement before release exposure increases. Safari background recovery and monitoring policy also remain unsettled, leaving the broad, feature-flagged, or delayed release choice open.',
    meaningfulChanges: recentEvent ? [{ title: recentEvent.title, whatChanged: recentEvent.summary ?? 'The project state changed.', consequence: 'The release path is clearer, but the remaining open questions still affect production readiness.', sourceNodeIds: (recentEvent.affectedNodeIds ?? []).filter((id) => validIds.has(id)), historyEventIds: [recentEvent.id] }] : [],
    goalImpact: {
      summary: 'The project is clearer because the two main design decisions are settled, but riskier until retry and Safari evidence is complete.',
      positiveFactors: resolved.slice(0, 2).map((node) => ({ text: node.text + ' is resolved.', sourceNodeIds: [node.id] })),
      negativeFactors: open.slice(0, 3).map((node) => ({ text: node.text, sourceNodeIds: [node.id] })),
    },
    unsettled: open.slice(0, 3).map((node) => ({ title: node.text, explanation: node.why_it_matters?.[0] ?? 'This unresolved item can change the release path.', sourceNodeIds: [node.id] })),
    criticalIssues: open.filter((node) => node.type === 'UNKNOWN' || node.type === 'RISK').slice(0, 3).map((node) => ({ severity: node.type === 'RISK' ? 'high' as const : 'medium' as const, title: node.text, explanation: node.why_it_matters?.[0] ?? 'This item remains unresolved.', sourceNodeIds: [node.id] })),
    emergingInsights: project.nodes.length >= 5 ? [{ text: 'The release is converging on a stable local-queue and idempotency design, while verification evidence—not architecture choice—is now the main constraint.', explanation: 'The resolved design decisions, reproduced timeout failure, and open verification questions form a consistent readiness pattern.', sourceNodeIds: project.nodes.filter((node) => ['DECISION', 'UNKNOWN', 'EVIDENCE', 'RISK'].includes(node.type)).slice(0, 6).map((node) => node.id) }] : [],
    confidence: 0.96,
  };
}

function makeSource(projectId: string, definition: SourceDefinition, timestamp: string): ContextSource {
  return {
    id: sourceId(projectId, definition.key),
    filename: definition.filename,
    type: definition.type,
    content: definition.content,
    extracted_at: timestamp,
    derived_node_ids: [],
    processing_status: 'completed',
    processed_at: timestamp,
    mime_type: definition.type === 'pdf' ? 'application/pdf' : 'text/plain',
    origin: 'user',
    extraction_summary: 'Deterministic RelayDesk fixture: ' + definition.title + '.',
    semantic_contribution: true,
    model_used: 'deterministic-fixture',
  };
}

function makeAskData(project: Project, sources: Map<DemoSourceKey, ContextSource>, timestamp: string): { chats: AskChatSession[]; messages: AskChatMessage[]; proposals: AskContextProposal[] } {
  const firstChat = chatId(project.id, 'duplicate-work-orders');
  const secondChat = chatId(project.id, 'release-strategy');
  const firstUser = messageId(project.id, 'duplicate-work-orders:user');
  const firstAssistant = messageId(project.id, 'duplicate-work-orders:assistant');
  const secondUser = messageId(project.id, 'release-strategy:user');
  const secondAssistant = messageId(project.id, 'release-strategy:assistant');
  const added: AskContextProposal = { id: proposalId(project.id, firstAssistant, 'operation-uuid'), type: 'KNOWN', text: 'Reuse one operation UUID for every retry of the same queued mutation.', targetNodeId: nodeId(project.id, 'operationUuid'), status: 'OPEN', sourceMessageId: firstAssistant, confirmationStatus: 'added' };
  const dismissed: AskContextProposal = { id: proposalId(project.id, secondAssistant, 'ten-percent-rollout'), type: 'RISK', text: 'Launching to 10% of beta technicians before retry verification could expose duplicate work orders.', status: 'OPEN', sourceMessageId: secondAssistant, confirmationStatus: 'dismissed' };
  const pending: AskContextProposal = { id: proposalId(project.id, secondAssistant, 'rollback-threshold'), type: 'DECISION', text: 'Define an automatic rollback threshold before enabling the feature flag.', status: 'OPEN', sourceMessageId: secondAssistant, confirmationStatus: 'pending' };
  const execution = { route: 'internal_context' as const, agent: 'Partner Agent', toolCalls: [] as string[], mode: 'simulated' as const, fixtureId: 'relaydesk-software-release', fixtureVersion: 1 };
  const userTimestamp = new Date(Date.parse(timestamp)).toISOString();
  const assistantTimestamp = new Date(Date.parse(timestamp) + 60 * 1000).toISOString();
  const chats: AskChatSession[] = [
    { id: firstChat, userId: 'demo', projectId: project.id, scopeType: 'project', title: 'Duplicate work orders', createdAt: userTimestamp, updatedAt: assistantTimestamp },
    { id: secondChat, userId: 'demo', projectId: project.id, scopeType: 'project', title: 'Release strategy', createdAt: userTimestamp, updatedAt: assistantTimestamp },
  ];
  const messages: AskChatMessage[] = [
    { id: firstUser, chatId: firstChat, userId: 'demo', projectId: project.id, role: 'user', text: 'Why does the retry create two work orders if the technician only submitted one?', sources: [], createdAt: userTimestamp, execution },
    { id: firstAssistant, chatId: firstChat, userId: 'demo', projectId: project.id, role: 'assistant', text: 'The first request can reach the server and commit successfully before the response is interrupted. Because the client receives no acknowledgement, it retries the mutation. Without a stable operation ID, the server cannot recognize that the second request represents the same offline action, so it creates another work order.', sources: [{ id: sources.get('worker')!.id, title: sources.get('worker')!.filename, excerpt: sources.get('worker')!.content, kind: 'source', reason: 'Shows the retry path.' }, { id: sources.get('timeout')!.id, title: sources.get('timeout')!.filename, excerpt: sources.get('timeout')!.content, kind: 'source', reason: 'Records the duplicate result.' }], createdAt: assistantTimestamp, contextProposals: [added], proposals: [added], execution },
    { id: secondUser, chatId: secondChat, userId: 'demo', projectId: project.id, role: 'user', text: 'Should we delay the release, or can the feature flag make this safe enough?', sources: [], createdAt: userTimestamp, execution },
    { id: secondAssistant, chatId: secondChat, userId: 'demo', projectId: project.id, role: 'assistant', text: 'A feature flag reduces exposure, but it does not prove retry correctness. Retry verification and Safari behavior remain prerequisites, so the release decision is still open.', sources: [{ id: sources.get('readiness')!.id, title: sources.get('readiness')!.filename, excerpt: sources.get('readiness')!.content, kind: 'source', reason: 'Shows the open release and monitoring picture.' }], createdAt: assistantTimestamp, contextProposals: [dismissed, pending], proposals: [dismissed, pending], execution },
  ];
  return { chats, messages, proposals: [added, dismissed, pending] };
}

async function uploadSourceIfConfigured(userId: string, source: ContextSource, definition: SourceDefinition): Promise<ContextSource> {
  if (source.type !== 'pdf' || !process.env.CLOUD_STORAGE_BUCKET?.trim()) return source;
  const bytes = pdfBytes(definition);
  const uploaded = await uploadContextSourcePdf({ userId, sourceId: source.id, filename: definition.filename, bytes, contentType: 'application/pdf' });
  return { ...source, storage_url: uploaded.storageUrl, size_bytes: bytes.length };
}

async function persistAssessments(storage: StorageProvider, userId: string, project: Project, focus: FocusAssessment | null, profile: UserMemoryProfile, memories: Awaited<ReturnType<StorageProvider['getMemories']>>): Promise<void> {
  const contextPack = buildContextPack({ userId, query: 'What is the current strategic state of this software release?', project, profile, durableMemories: memories, calendarCommitments: [], conversationMessages: [], researchEvidence: [], includeBroadContext: true, scope: { type: 'project', projectId: project.id } });
  const now = project.updated_at;
  if (focus) {
    const focusVersion = await focusProjectStateVersion(project, contextPack, profile);
    await storage.saveFocusAssessment(userId, { id: focusAssessmentCacheId(project.id, focusVersion), userId, projectId: project.id, projectStateVersion: focusVersion, assessment: focus, createdAt: now, updatedAt: now });
  }
  const overview = makeOverview(project);
  const overviewVersion = await overviewProjectStateVersion(project, project.historyEvents ?? [], focus, contextPack, profile);
  await storage.saveProjectOverviewAssessment(userId, { id: projectOverviewAssessmentCacheId(project.id, overviewVersion), userId, projectId: project.id, projectStateVersion: overviewVersion, assessment: overview, createdAt: now, updatedAt: now });
  const suggestionVersion = await askSuggestionsProjectStateVersion(project, profile, memories);
  const projectVersion = semanticProjectVersion(project);
  await storage.saveAskSuggestionsCache(userId, { id: askSuggestionsCurrentCacheId(project.id), userId, projectId: project.id, scopeKey: project.id, projectStateVersion: suggestionVersion, semanticProjectVersion: projectVersion, requestedSemanticProjectVersion: projectVersion, publishedInputVersion: suggestionVersion, topQuestions: ['Why is retry verification blocking the release decision?', 'What evidence is still missing for Safari?', 'What would a safe feature-flag rollout require?'], otherQuestions: ['Which release risks are already mitigated?', 'What should the two engineers work on first?'], generatedBy: 'relaydesk-software-release-deterministic', createdAt: now, updatedAt: now, requestedAt: now, generatedAt: now, status: 'ready' });
}

async function snapshotState(storage: StorageProvider, userId: string, project: Project, trigger: Parameters<typeof createProjectSnapshot>[0]['trigger'], label: string, summary: string, focus: FocusAssessment | null): Promise<void> {
  const profile = await storage.getUserMemoryProfile(userId) ?? DEFAULT_USER_PROFILE;
  const memories = await storage.getMemories(userId);
  await persistAssessments(storage, userId, project, focus, profile, memories);
  await createProjectSnapshot({ userId, projectId: project.id, trigger, label, summary });
}

async function createSoftwareReleaseDemoUnlocked(params: { userId: string; storage: StorageProvider; now?: Date }): Promise<SoftwareReleaseDemoResult> {
  const storage = params.storage;
  const existingProjects = await storage.listProjects(params.userId);
  const title = nextAvailableProjectTitle(SOFTWARE_RELEASE_DEMO_TITLE, existingProjects);
  const createdAt = createdAtWithoutCollision(title, SOFTWARE_RELEASE_DEMO_GOAL, existingProjects, params.now?.getTime() ?? Date.now());
  let project = createProjectFromInput({ name: title, goal: SOFTWARE_RELEASE_DEMO_GOAL, description: SOFTWARE_RELEASE_DESCRIPTION, deadline: SOFTWARE_RELEASE_DEMO_DEADLINE }, createdAt);
  const recorder = await startDeveloperGenerationRun({ userId: params.userId, projectId: project.id, generator: 'RelayDesk software-release deterministic fixture', storage });
  try {
    await recorder.step({ name: 'Create workspace fixture', category: 'project', summary: 'Created RelayDesk project metadata without AI.' }, async () => {
      await storage.saveProject(params.userId, project);
      await createProjectSnapshot({ userId: params.userId, projectId: project.id, trigger: { type: 'project_created', historyEventId: project.historyEvents?.[0]?.id }, label: 'Project started', summary: 'Created the RelayDesk offline sync release workspace.' });
    });

    const sources = new Map<DemoSourceKey, ContextSource>();
    const nodes = new Map<DemoNodeKey, ClarityNode>();
    const addSourceStep = async (definition: SourceDefinition, keys: DemoNodeKey[], hour: number, title: string, summary: string) => {
      await recorder.step({ name: 'Add ' + definition.filename, category: 'source', filename: definition.filename, summary: 'Wrote deterministic source and graph fixture records; no Context Agent call.' }, async () => {
        const timestamp = new Date(Date.parse(createdAt) + hour * 60 * 60 * 1000).toISOString();
        let source = makeSource(project.id, definition, timestamp);
        sources.set(definition.key, source);
        source = await uploadSourceIfConfigured(params.userId, source, definition);
        sources.set(definition.key, source);
        const sourceNodes = keys.map((key) => {
          const definitionItem = nodeDefinitions.find((item) => item.key === key);
          if (!definitionItem) throw new Error('RelayDesk fixture node definition is missing: ' + key);
          const node = makeNode(project.id, definitionItem, sources, timestamp);
          nodes.set(key, node);
          return node;
        });
        source.derived_node_ids = sourceNodes.map((node) => node.id);
        const event = makeEvent(project, definition.key, timestamp, title, summary, sourceNodes, { sourceId: source.id, sourceNodeIds: sourceNodes.map((node) => node.id) });
        project = { ...project, sources: [...project.sources, source], nodes: [...project.nodes, ...sourceNodes], historyEvents: [...(project.historyEvents ?? []), event], updated_at: timestamp };
        await storage.saveProject(params.userId, project);
        await snapshotState(storage, params.userId, project, { type: 'context_processed', sourceId: source.id, historyEventId: event.id }, title, summary, makeFocus(project, sources));
        return { sourceId: source.id, historyEventId: event.id };
      });
    };

    await addSourceStep(sourceDefinitions[0], ['technicians', 'connectivity', 'beta', 'production', 'release'], 1, 'Product brief added', 'The product brief established the technician population, release dates, success criteria, and open release strategy.');
    await addSourceStep(sourceDefinitions[1], ['indexeddb', 'ambiguous', 'operationUuid', 'idempotency', 'backwardCompatibility'], 2, 'Architecture note added', 'The architecture note established the IndexedDB queue, ambiguous timeout behavior, operation identity, and compatibility constraint.');
    await addSourceStep(sourceDefinitions[2], ['retryCode'], 3, 'Sync worker excerpt added', 'The code excerpt exposed the unstable retry identity in the original worker.');
    await addSourceStep(sourceDefinitions[3], ['duplicateEvidence', 'duplicateRisk', 'retryQuestion', 'timeoutAction'], 4, 'Timeout test report added', 'The failing timeout test reproduced duplicate creation and defined the retry verification needed before release.');
    await addSourceStep(sourceDefinitions[4], ['safariQuestion', 'safariAction'], 5, 'Safari compatibility report added', 'The browser report kept Safari recovery unresolved and recorded the next verification action.');
    await addSourceStep(sourceDefinitions[5], ['tokenConstraint'], 6, 'Security review added', 'The security review approved local metadata with a strict token-storage constraint.');
    await addSourceStep(sourceDefinitions[6], ['dashboardQuestion', 'monitoring', 'engineers', 'metricsAction', 'featureFlagAction'], 7, 'Release readiness notes added', 'Readiness notes established staffing limits, monitoring gaps, and the existing feature-flag path.');

    await recorder.step({ name: 'Write graph relationships', category: 'validation', summary: 'Wrote the bounded deterministic relationship fixture.' }, async () => {
      const goal = project.nodes[0];
      const get = (key: DemoNodeKey) => nodes.get(key)!;
      const edges: ClarityEdge[] = [
        makeEdge(project.id, 'connectivity-risk', get('connectivity'), get('duplicateRisk'), 'informs'),
        makeEdge(project.id, 'ambiguous-risk', get('ambiguous'), get('duplicateRisk'), 'informs'),
        makeEdge(project.id, 'retry-code-risk', get('retryCode'), get('duplicateRisk'), 'informs'),
        makeEdge(project.id, 'duplicate-evidence-risk', get('duplicateEvidence'), get('duplicateRisk'), 'informs'),
        makeEdge(project.id, 'risk-idempotency', get('duplicateRisk'), get('idempotency'), 'informs'),
        makeEdge(project.id, 'risk-release', get('duplicateRisk'), get('release'), 'blocks'),
        makeEdge(project.id, 'idempotency-retry', get('idempotency'), get('retryQuestion'), 'affects'),
        makeEdge(project.id, 'retry-release', get('retryQuestion'), get('release'), 'blocks'),
        makeEdge(project.id, 'safari-release', get('safariQuestion'), get('release'), 'blocks'),
        makeEdge(project.id, 'dashboard-monitoring', get('dashboardQuestion'), get('monitoring'), 'affects'),
        makeEdge(project.id, 'beta-release', get('beta'), get('release'), 'affects'),
        makeEdge(project.id, 'production-goal', get('production'), goal, 'affects'),
        makeEdge(project.id, 'engineers-release', get('engineers'), get('release'), 'affects'),
        makeEdge(project.id, 'token-indexeddb', get('tokenConstraint'), get('indexeddb'), 'affects'),
        makeEdge(project.id, 'backward-release', get('backwardCompatibility'), get('release'), 'affects'),
        makeEdge(project.id, 'indexeddb-goal', get('indexeddb'), goal, 'affects'),
        makeEdge(project.id, 'idempotency-goal', get('idempotency'), goal, 'affects'),
        makeEdge(project.id, 'operation-idempotency', get('operationUuid'), get('idempotency'), 'informs'),
        makeEdge(project.id, 'operation-retry', get('operationUuid'), get('retryQuestion'), 'informs'),
        makeEdge(project.id, 'evidence-retry', get('duplicateEvidence'), get('retryQuestion'), 'informs'),
        makeEdge(project.id, 'retry-action-question', get('timeoutAction'), get('retryQuestion'), 'satisfies'),
        makeEdge(project.id, 'safari-action-question', get('safariAction'), get('safariQuestion'), 'satisfies'),
        makeEdge(project.id, 'metrics-monitoring', get('metricsAction'), get('monitoring'), 'affects'),
        makeEdge(project.id, 'feature-release', get('featureFlagAction'), get('release'), 'affects'),
        makeEdge(project.id, 'monitoring-release', get('monitoring'), get('release'), 'affects'),
        makeEdge(project.id, 'monitoring-feature-flag', get('monitoring'), get('featureFlagAction'), 'affects'),
        makeEdge(project.id, 'release-goal', get('release'), goal, 'affects'),
        makeEdge(project.id, 'safari-monitoring', get('safariQuestion'), get('monitoring'), 'affects'),
        makeEdge(project.id, 'risk-monitoring', get('duplicateRisk'), get('monitoring'), 'affects'),
        makeEdge(project.id, 'retry-monitoring', get('retryQuestion'), get('monitoring'), 'affects'),
        makeEdge(project.id, 'technicians-goal', get('technicians'), goal, 'supports'),
      ];
      project = { ...project, edges, updated_at: new Date(Date.parse(createdAt) + 8 * 60 * 60 * 1000).toISOString() };
      const event = makeEvent(project, 'graph-relationships', project.updated_at, 'Release dependency map prepared', 'Connected the timeout, Safari, monitoring, staffing, security, and release dependencies.', [...nodes.values()], { type: 'context_changed', primaryNodeId: nodeId(project.id, 'retryQuestion') });
      project = { ...project, historyEvents: [...(project.historyEvents ?? []), event] };
      await storage.saveProject(params.userId, project);
      await snapshotState(storage, params.userId, project, { type: 'context_processed', historyEventId: event.id }, 'Release dependency map prepared', event.summary!, makeFocus(project, sources));
    });

    const resolveDecision = async (key: DemoNodeKey, outcome: string, suffix: string, hour: number, title: string) => {
      await recorder.step({ name: title, category: 'resolution', summary: 'Recorded a deterministic decision outcome.' }, async () => {
        const decision = nodes.get(key)!;
        decision.status = 'RESOLVED';
        decision.decision_outcome = outcome;
        decision.updated_at = new Date(Date.parse(createdAt) + hour * 60 * 60 * 1000).toISOString();
        project = { ...project, nodes: project.nodes.map((node) => node.id === decision.id ? decision : node), history: [...project.history, { question: decision.text, answer: outcome, timestamp: decision.updated_at, graph_diff_summary: suffix, nodeId: decision.id, projectId: project.id }], updated_at: decision.updated_at };
        const event = makeEvent(project, key + '-resolved', decision.updated_at, title, suffix, [decision], { type: 'decision_resolved', primaryNodeId: decision.id });
        project = { ...project, historyEvents: [...(project.historyEvents ?? []), event] };
        await storage.saveProject(params.userId, project);
        await snapshotState(storage, params.userId, project, { type: 'decision_confirmed', nodeId: decision.id, historyEventId: event.id }, title, suffix, makeFocus(project, sources));
      });
    };
    await resolveDecision('indexeddb', 'IndexedDB was selected because the queue must survive page reloads and support structured mutation records larger than localStorage should hold.', 'IndexedDB was selected for persisted offline mutations.', 9, 'IndexedDB decision confirmed');

    await recorder.step({ name: 'Save duplicate-retry Ask conversation', category: 'ask', chatId: chatId(project.id, 'duplicate-work-orders'), messageId: messageId(project.id, 'duplicate-work-orders:assistant'), summary: 'Saved a simulated Ask conversation and accepted operation-UUID proposal.' }, async () => {
      const data = makeAskData(project, new Map(sourceDefinitions.map((definition) => [definition.key, project.sources.find((source) => source.id === sourceId(project.id, definition.key))!])), new Date(Date.parse(createdAt) + 10 * 60 * 60 * 1000).toISOString());
      const chat = data.chats.find((candidate) => candidate.id === chatId(project.id, 'duplicate-work-orders'));
      if (!chat) throw new Error('RelayDesk duplicate-retry chat fixture is missing.');
      await storage.saveAskChat(params.userId, { ...chat, userId: params.userId });
      for (const message of data.messages.slice(0, 2)) await storage.saveAskMessage(params.userId, { ...message, userId: params.userId });
      const event = makeEvent(project, 'proposal-added', data.messages[1].createdAt, 'Retry proposal accepted', 'The user accepted the proposal to reuse one operation UUID for every retry.', [nodes.get('operationUuid')!], { type: 'ask_proposal_added', primaryNodeId: nodes.get('operationUuid')!.id });
      project = { ...project, historyEvents: [...(project.historyEvents ?? []), event], updated_at: event.createdAt };
      await storage.saveProject(params.userId, project);
      await snapshotState(storage, params.userId, project, { type: 'ask_proposal_added', askMessageId: data.messages[1].id, proposalId: data.proposals[0].id, historyEventId: event.id }, 'Retry proposal accepted', event.summary!, makeFocus(project, sources));
    });

    await resolveDecision('idempotency', 'The client will reuse the same operation UUID on every retry. The server will return the original result when the UUID was previously committed.', 'Client UUIDs and server idempotency records were selected.', 11, 'Idempotency strategy confirmed');

    await recorder.step({ name: 'Save release-strategy Ask conversation', category: 'ask', chatId: chatId(project.id, 'release-strategy'), messageId: messageId(project.id, 'release-strategy:assistant'), summary: 'Saved a simulated trade-off response with dismissed and pending proposals.' }, async () => {
      const sourceMap = new Map(sourceDefinitions.map((definition) => [definition.key, project.sources.find((source) => source.id === sourceId(project.id, definition.key))!]));
      const data = makeAskData(project, sourceMap, new Date(Date.parse(createdAt) + 12 * 60 * 60 * 1000).toISOString());
      const chat = data.chats.find((candidate) => candidate.id === chatId(project.id, 'release-strategy'));
      if (!chat) throw new Error('RelayDesk release-strategy chat fixture is missing.');
      await storage.saveAskChat(params.userId, { ...chat, userId: params.userId });
      for (const message of data.messages.slice(2)) await storage.saveAskMessage(params.userId, { ...message, userId: params.userId });
      const event = makeEvent(project, 'release-strategy-chat', data.messages[3].createdAt, 'Release strategy discussion saved', 'The feature-flag trade-off was discussed without resolving the release decision.', [nodes.get('release')!, nodes.get('monitoring')!], { type: 'context_changed', primaryNodeId: nodes.get('release')!.id });
      project = { ...project, historyEvents: [...(project.historyEvents ?? []), event], updated_at: event.createdAt };
      await storage.saveProject(params.userId, project);
      await snapshotState(storage, params.userId, project, { type: 'ask_response_created', askMessageId: data.messages[3].id, historyEventId: event.id }, 'Release strategy discussion saved', event.summary!, makeFocus(project, sources));
    });

    await recorder.step({ name: 'Validate final prepared state', category: 'validation', summary: 'Validated fixture references, open decisions, actionable questions, and deterministic execution metadata.' }, async () => {
      const nodeIds = new Set(project.nodes.map((node) => node.id));
      if (project.nodes.length < 18 || project.nodes.length > 24) throw new Error('RelayDesk fixture expected 18–24 nodes, found ' + project.nodes.length + '.');
      if (project.edges.length < 25 || project.edges.length > 35) throw new Error('RelayDesk fixture expected 25–35 edges, found ' + project.edges.length + '.');
      if (project.edges.some((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))) throw new Error('RelayDesk fixture contains a dangling relationship.');
      const focus = makeFocus(project, sources);
      if (!focus || focus.targetNodeId !== nodeId(project.id, 'retryQuestion') || !nodeIds.has(focus.actionNodeId!)) throw new Error('RelayDesk fixture focus target is not anchored to the retry question.');
      await storage.setAppScope(params.userId, { type: 'project', projectId: project.id });
    });

    await recorder.complete();
    const finalProject = await storage.getProject(params.userId, project.id);
    if (!finalProject) throw new Error('RelayDesk demo was not available after persistence.');
    const snapshots = await storage.listProjectSnapshots(params.userId, project.id);
    const chats = (await storage.getAskChats(params.userId)).filter((chat) => chat.projectId === project.id);
    const messages = (await storage.getAskMessages(params.userId)).filter((message) => message.projectId === project.id);
    recordTrace({
      userId: params.userId,
      route: '/api/demos/software-release',
      label: 'RelayDesk software release demo',
      started_at: recorder.run.startedAt,
      duration_ms: recorder.run.durationMs ?? 0,
      agentNames: [],
      contextIds: [],
      scores: [],
      toolCalls: [],
      model: 'deterministic-fixture',
      simulation: true,
      agentRuns: [{
        runId: recorder.run.id,
        agent: 'Deterministic fixture writer',
        model: 'deterministic-fixture',
        thinkingLevel: 'none',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: recorder.run.durationMs ?? 0,
        estimatedCost: 0,
        costSource: 'zero_cost_deterministic',
        validationStatus: 'passed',
        confidence: 1,
        escalated: false,
        execution: 'deterministic',
        inputSummary: 'Static RelayDesk fixture definitions.',
        outputSummary: 'Project, sources, graph, Ask records, assessments, history, and snapshots written without an AI call.',
      }],
      pipelineSteps: [{
        name: 'Deterministic demo generation',
        agentName: 'Deterministic fixture writer',
        summary: 'No Gemini, ADK, search, Context Agent, or live assessment generation was used.',
        execution: 'deterministic',
      }],
    });
    return { project: finalProject, projects: await storage.listProjects(params.userId), activeProjectId: project.id, scope: { type: 'project', projectId: project.id }, created: true, generationRunId: recorder.run.id, snapshotCount: snapshots.length, historyEventCount: finalProject.historyEvents?.length ?? 0, finalNodeCount: finalProject.nodes.length, finalEdgeCount: finalProject.edges.length, sourceCount: finalProject.sources.length, chatCount: chats.length, messageCount: messages.length, proposalCount: messages.flatMap((message) => message.contextProposals ?? message.proposals ?? []).length, aiCalls: 0, execution: 'simulated', assessments: { focus: 'ready', overview: 'ready', today: 'ready', askSuggestions: 'ready' } };
  } catch (error) {
    await recorder.fail(error);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { generationRunId: recorder.run.id, projectId: project.id });
  }
}

export async function createSoftwareReleaseDemoForUser(params: { userId: string; storage?: StorageProvider; now?: Date }): Promise<SoftwareReleaseDemoResult> {
  const existing = generationLocks.get(params.userId);
  if (existing) return existing;
  const request = createSoftwareReleaseDemoUnlocked({ userId: params.userId, storage: params.storage ?? getStorageProvider(), now: params.now });
  generationLocks.set(params.userId, request);
  try {
    return await request;
  } finally {
    if (generationLocks.get(params.userId) === request) generationLocks.delete(params.userId);
  }
}

export function clearSoftwareReleaseDemoLocksForTests(): void {
  generationLocks.clear();
}
