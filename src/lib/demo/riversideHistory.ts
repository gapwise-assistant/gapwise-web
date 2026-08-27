import { uploadContextSourcePdf } from '@/lib/storage/gcsAssets';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';
import { confirmDecision } from '@/lib/decisions/workspace';
import { answerQuestion } from '@/lib/questions/answerQuestion';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { hashText } from '@/lib/context/ingestion';
import { refreshProjectGapRuntime } from '@/lib/agents/gapRuntime';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { getStorageProvider } from '@/lib/storage';
import { persistAskConversationContext, persistAskProposal } from '@/lib/ask/conversationContext';
import { askGapswise } from '@/lib/ask/adkClient';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import { focusAssessmentCacheId, focusProjectStateVersion, getCachedFocusAssessment } from '@/lib/focus/focusCache';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import {
  overviewProjectStateVersion,
  projectOverviewAssessmentCacheId,
  getProjectOverviewAssessmentWithMetadata,
} from '@/lib/overview/projectOverviewCache';
import type { ProjectOverviewAssessment } from '@/lib/overview/projectOverviewAssessment';
import { generateDailyBrief } from '@/lib/attention/generateBrief';
import { buildGraphHealthReport } from '@/lib/graph/decisionMapDebug';
import type { AppScope } from '@/types/scope';
import type { ClarityNode, EdgeType, Project, ProjectHistoryEvent } from '@/types/clarity';
import type { AskChatMessage, AskChatSession, AskContextProposal, AskResult } from '@/types/ask';
import { normalizeAskContextProposals } from '@/types/ask';
import { boundedId } from '@/lib/ids/boundedId';
import type { ProjectSnapshot, ProjectSnapshotTrigger } from '@/types/projectSnapshot';
import {
  attachDeveloperGenerationError,
  recordDeveloperGenerationStep,
  type DeveloperGenerationRecorder,
  startDeveloperGenerationRun,
} from '@/lib/observability/developerGeneration';

export const RIVERSIDE_HISTORY_DEMO_TITLE = 'Riverside Meal Delivery Pilot';
export const RIVERSIDE_HISTORY_DEMO_GOAL =
  'Launch a six-week Riverside meal-delivery pilot serving 80 meals every Wednesday, with kitchen access, food-safety requirements, pricing, volunteer delivery coverage, and launch readiness confirmed.';
export const RIVERSIDE_HISTORY_DEMO_DEADLINE = '2026-10-07';

export interface RiversideHistoryDocument {
  slug: string;
  filename: string;
  title: string;
  preparedBy: string;
  date: string;
  content: string;
}

export const RIVERSIDE_HISTORY_DOCUMENTS: readonly RiversideHistoryDocument[] = [
  {
    slug: 'pilot-brief',
    filename: 'Riverside Pilot Brief.pdf',
    title: 'Riverside Meal Delivery Pilot Brief',
    preparedBy: 'Leah Morgan, Pilot Coordinator',
    date: 'August 18, 2026',
    content: `Riverside Meal Delivery Pilot Brief

Prepared by: Leah Morgan, Pilot Coordinator
Date: August 18, 2026
Version: 1.0

Pilot summary
Riverside wants a six-week meal-delivery pilot serving 80 meals every Wednesday. The target launch is October 7, 2026. The pilot should make healthy meals available to residents while testing a repeatable, affordable operating model.

| Measure | Pilot target |
| Service period | Six Wednesdays beginning October 7, 2026 |
| Weekly volume | 80 meals |
| Customer promise | Reliable Wednesday delivery |
| Open choices | Meal price, service area, menu, and delivery coverage |

The pilot needs kitchen access, food-safety compliance, a workable price, volunteer delivery coverage, and a complete packing-and-delivery rehearsal before launch. The team has not yet settled the final operating model.`,
  },
  {
    slug: 'kitchen-volunteers',
    filename: 'Kitchen and Volunteer Update.pdf',
    title: 'Kitchen and Volunteer Update',
    preparedBy: 'Noah Brooks, Operations',
    date: 'August 20, 2026',
    content: `Kitchen and Volunteer Update

Prepared by: Noah Brooks, Operations
Date: August 20, 2026
Version: 1.0

Kitchen access
The Riverside Community Kitchen is available every Wednesday from 2:00 PM to 8:00 PM for the six-week pilot. The kitchen manager requires a current insurance certificate before the first cooking shift.

| Requirement | Current status |
| Kitchen booking | Available Wednesdays; final paperwork pending |
| Insurance certificate | Required before cooking begins |
| Allergen list | Required with each menu |
| Volunteer delivery | Four drivers have volunteered |

Four volunteers are available for most Wednesdays, but complete driver coverage has not been confirmed for every route. A backup-driver plan may be needed if volunteers cancel.`,
  },
  {
    slug: 'meal-cost-research',
    filename: 'Meal Cost and Customer Research.pdf',
    title: 'Meal Cost and Customer Research',
    preparedBy: 'Priya Shah, Customer Research',
    date: 'August 22, 2026',
    content: `Meal Cost and Customer Research

Prepared by: Priya Shah, Customer Research
Date: August 22, 2026
Version: 1.0

Cost estimate
The current estimate per meal is $5.20 for ingredients, $1.10 for packaging, $0.90 for kitchen time, and $2.10 for delivery. The estimate does not include volunteer reimbursement or a contingency for substitutions.

| Cost item | Estimated cost per meal |
| Ingredients | $5.20 |
| Packaging | $1.10 |
| Kitchen time | $0.90 |
| Delivery | $2.10 |
| Estimated total | $9.30 |

Customer interviews suggest that residents expect to pay approximately $12–$15 per meal. The final meal price and whether delivery is included remain open decisions. The team has not yet chosen the initial service area or menu rotation.`,
  },
  {
    slug: 'food-safety-delivery',
    filename: 'Food Safety and Delivery Review.pdf',
    title: 'Food Safety and Delivery Review',
    preparedBy: 'Dr. Elena Ruiz, Food Safety Advisor',
    date: 'August 25, 2026',
    content: `Food Safety and Delivery Review

Prepared by: Dr. Elena Ruiz, Food Safety Advisor
Date: August 25, 2026
Version: 1.0

Safety and delivery review
The temporary food-service permit application has been submitted but has not yet been approved. Meals must remain within the required temperature range during packing and delivery. A cooler test held the target temperature for 75 minutes, while the longest planned route is estimated at 55 minutes.

| Review item | Current status |
| Food-service permit | Submitted; approval pending |
| Temperature control | Cooler test passed for 75 minutes |
| Longest planned route | Estimated at 55 minutes |
| Delivery resilience | Backup delivery requirement not yet settled |

The delivery route plan still needs a backup for driver cancellations. The team should run a complete packing-and-delivery rehearsal before launch authorization.`,
  },
  {
    slug: 'final-readiness',
    filename: 'Final Readiness Report.pdf',
    title: 'Riverside Final Readiness Report',
    preparedBy: 'Leah Morgan, Pilot Coordinator',
    date: 'September 28, 2026',
    content: `Riverside Final Readiness Report

Prepared by: Leah Morgan, Pilot Coordinator
Date: September 28, 2026
Version: 1.0

Readiness status
The Riverside pilot will serve 80 meals every Wednesday for six weeks. The meal price has been approved at $14, the initial service area is Riverside North, and the rotating menu has been confirmed. The kitchen booking, insurance certificate, allergen list, and food-service permit are complete.

| Readiness item | Final status |
| Meal price | Approved at $14 per meal |
| Service area | Riverside North selected |
| Kitchen and compliance | Confirmed |
| Delivery coverage | Primary and backup drivers confirmed |
| Packing-and-delivery rehearsal | Not yet completed |

The remaining launch blocker is the complete packing-and-delivery rehearsal. It must be completed before the first Wednesday service so the team can verify timing, temperature control, route handoff, and backup procedures.`,
  },
];

interface RiversideDemoProposalSpec {
  type: AskContextProposal['type'];
  text: string;
}

const RIVERSIDE_DEMO_PROPOSALS: Record<string, readonly RiversideDemoProposalSpec[]> = {
  validation: [
    { type: 'UNKNOWN', text: 'Confirm whether the Riverside Community Kitchen paperwork will be complete before the first cooking shift.' },
    { type: 'NEXT_ACTION', text: 'Run a complete packing-and-delivery rehearsal before launch.' },
    { type: 'ASSUMPTION', text: 'Promise delivery across the entire city for the first six-week pilot.' },
  ],
  cancellations: [
    { type: 'RISK', text: 'Volunteer driver cancellations could leave one or more Wednesday routes uncovered.' },
    { type: 'NEXT_ACTION', text: 'Prepare a backup-driver list for the Wednesday delivery routes.' },
  ],
  pricing: [
    { type: 'DECISION', text: 'Set the initial Riverside meal price and decide whether delivery is included.' },
    { type: 'UNKNOWN', text: 'Confirm whether the food-service permit will be approved before the first service.' },
  ],
};

function pdfEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7e]/g, '?');
}

function wrappedLines(value: string, width = 94): string[] {
  return value.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [''];
    const lines: string[] = [];
    let current = '';
    line.split(/\s+/).forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (next.length > width && current) {
        lines.push(current);
        current = word;
      } else current = next;
    });
    if (current) lines.push(current);
    return lines;
  });
}

function pdfBytes(document: RiversideHistoryDocument): Buffer {
  const lines = wrappedLines(document.content);
  const pageLines = Array.from({ length: Math.max(1, Math.ceil(lines.length / 48)) }, (_, index) =>
    lines.slice(index * 48, (index + 1) * 48));
  const pageIds = pageLines.map((_, index) => index + 3);
  const fontId = pageIds.at(-1)! + 1;
  const contentStart = fontId + 1;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
    ...pageLines.map((_, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentStart + index} 0 R >>`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pageLines.map((page, index) => {
      const body = [
        'BT', '/F1 16 Tf', '72 748 Td', `(${pdfEscape(page[0] ?? document.title)}) Tj`,
        '/F1 9 Tf', '0 -20 Td',
        ...page.slice(1).flatMap((line) => [`(${pdfEscape(line)}) Tj`, '0 -13 Td']),
        'ET', 'BT', '/F1 8 Tf', '72 28 Td', `(${pdfEscape(`Page ${index + 1} of ${pageLines.length}`)}) Tj`, 'ET',
      ].join('\n');
      return `<< /Length ${Buffer.byteLength(body, 'ascii')} >>\nstream\n${body}\nendstream`;
    }),
  ];
  let output = '%PDF-1.4\n%Gapwise Riverside\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, 'ascii'));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, 'ascii');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'ascii');
}

function sourceIdFor(projectId: string, document: RiversideHistoryDocument): string {
  return boundedId('source', `${projectId}_${document.slug}`);
}

function askRecordId(projectId: string, turn: string, role: 'user' | 'assistant'): string {
  return boundedId('ask', `${projectId}_${turn}_${role}`);
}

function proposalIdFor(assistantMessageId: string, proposal: RiversideDemoProposalSpec): string {
  return boundedId('proposal', `${assistantMessageId}_${proposal.type}_${proposal.text}`);
}

function proposalSourceIdFor(assistantMessageId: string, proposalId: string): string {
  return boundedId('ask_proposal', `${assistantMessageId}_${proposalId}`);
}

function latestEvent(project: Project, type: ProjectHistoryEvent['type'], predicate?: (event: ProjectHistoryEvent) => boolean): ProjectHistoryEvent | undefined {
  return [...(project.historyEvents ?? [])].reverse().find((event) => event.type === type && (!predicate || predicate(event)));
}

function transitionType(event: ProjectHistoryEvent): ProjectSnapshotTrigger | null {
  switch (event.type) {
    case 'project_started': return 'project_created';
    case 'context_added': return 'context_processed';
    case 'decision_resolved': return 'decision_confirmed';
    case 'gap_resolved': return 'gap_resolved';
    case 'action_completed': return 'action_completed';
    case 'ask_proposal_added': return 'ask_proposal_added';
    case 'ask_proposal_dismissed': return 'ask_proposal_dismissed';
    case 'focus_changed': return 'focus_changed';
    default: return null;
  }
}

async function prepareAssessments(userId: string, project: Project, recorder?: DeveloperGenerationRecorder): Promise<void> {
  const storage = getStorageProvider();
  const memories = await storage.getMemories(userId);
  const contextPack = await buildContextPackForUser({
    userId,
    query: 'What is the current strategic state of this project?',
    project,
    profile: DEFAULT_USER_PROFILE,
    durableMemories: memories,
    scope: { type: 'project', projectId: project.id },
    includeBroadContext: true,
  });
  let focus = await recordDeveloperGenerationStep(
    recorder,
    { name: 'Focus assessment obtained', category: 'assessment', summary: 'Loaded the current Focus assessment.' },
    () => getCachedFocusAssessment(userId, project, contextPack, DEFAULT_USER_PROFILE),
  );
  if (!focus) {
    const goal = project.nodes.find((node) => node.type === 'GOAL');
    focus = {
      kind: 'discovery',
      title: goal?.text ?? project.goal,
      representedNodeIds: goal ? [goal.id] : [],
      sourceNodeIds: goal ? [goal.id] : [],
      sourceIds: [],
      ...(goal ? { targetNodeId: goal.id, actionNodeId: goal.id } : {}),
      score: 0,
      confidence: 1,
    } satisfies FocusAssessment;
    const version = await focusProjectStateVersion(project, contextPack, DEFAULT_USER_PROFILE);
    const now = new Date().toISOString();
    await recordDeveloperGenerationStep(
      recorder,
      { name: 'Focus assessment obtained', category: 'assessment', summary: 'Saved the starting Focus assessment.' },
      () => storage.saveFocusAssessment(userId, {
        id: focusAssessmentCacheId(project.id, version), userId, projectId: project.id,
        projectStateVersion: version, assessment: focus, createdAt: now, updatedAt: now,
      }),
    );
  }
  try {
    await recordDeveloperGenerationStep(
      recorder,
      { name: 'Overview assessment obtained', category: 'assessment', summary: 'Loaded the current Overview assessment.' },
      () => getProjectOverviewAssessmentWithMetadata(userId, project, project.historyEvents ?? [], focus, contextPack),
    );
  } catch {
    const openItems = project.nodes.filter((node) => node.status === 'OPEN' && ['DECISION', 'UNKNOWN', 'ASSUMPTION', 'RISK'].includes(node.type)).slice(0, 3);
    const assessment: ProjectOverviewAssessment = {
      trajectory: { state: openItems.length ? 'taking_shape' : 'moving_forward', explanation: `The project currently has ${openItems.length} important open item${openItems.length === 1 ? '' : 's'}.` },
      summary: `${project.title} is progressing toward its meal-delivery launch while the remaining open items are worked through.`,
      meaningfulChanges: [],
      goalImpact: { summary: 'The current project state is grounded in the recorded goal, context, and decisions.', positiveFactors: [], negativeFactors: [] },
      unsettled: openItems.map((node) => ({ title: node.text, explanation: 'This item remains open in the project graph.', sourceNodeIds: [node.id] })),
      criticalIssues: [], emergingInsights: [], confidence: 0.5,
    };
    const version = await overviewProjectStateVersion(project, project.historyEvents ?? [], focus, contextPack);
    const now = new Date().toISOString();
    await recordDeveloperGenerationStep(
      recorder,
      { name: 'Overview assessment obtained', category: 'assessment', summary: 'Saved the grounded Overview assessment.' },
      () => storage.saveProjectOverviewAssessment(userId, {
        id: projectOverviewAssessmentCacheId(project.id, version), userId, projectId: project.id,
        projectStateVersion: version, assessment, createdAt: now, updatedAt: now,
      }),
    );
  }
  await recordDeveloperGenerationStep(
    recorder,
    { name: 'Today state obtained', category: 'assessment', summary: 'Generated the current Today brief.' },
    () => generateDailyBrief({ userId, project, memories, contextPack, force: false }),
  );
}

async function snapshotForEvent(params: {
  userId: string;
  project: Project;
  event: ProjectHistoryEvent;
  type: ProjectSnapshotTrigger;
  sourceId?: string;
  nodeId?: string;
  askMessageId?: string;
  proposalId?: string;
  label: string;
  summary?: string;
  recorder?: DeveloperGenerationRecorder;
}): Promise<ProjectSnapshot> {
  await prepareAssessments(params.userId, params.project, params.recorder);
  const snapshot = await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'History snapshot saved', category: 'snapshot', historyEventId: params.event.id, ...(params.sourceId ? { sourceId: params.sourceId } : {}), ...(params.askMessageId ? { messageId: params.askMessageId } : {}), ...(params.proposalId ? { proposalId: params.proposalId } : {}), summary: params.label },
    () => createProjectSnapshot({
      userId: params.userId,
      projectId: params.project.id,
      trigger: {
        type: params.type,
        historyEventId: params.event.id,
        ...(params.sourceId ? { sourceId: params.sourceId } : {}),
        ...(params.nodeId ? { nodeId: params.nodeId } : {}),
        ...(params.askMessageId ? { askMessageId: params.askMessageId } : {}),
        ...(params.proposalId ? { proposalId: params.proposalId } : {}),
      },
      label: params.label,
      summary: params.summary,
    }),
  );
  if (snapshot.trigger.historyEventId !== params.event.id) throw new Error(`Riverside snapshot ${params.label} lost its history event reference.`);
  return snapshot;
}

async function snapshotNewEvents(userId: string, before: Project, after: Project, label: string, sourceId?: string, recorder?: DeveloperGenerationRecorder): Promise<void> {
  const prior = new Set((before.historyEvents ?? []).map((event) => event.id));
  for (const event of (after.historyEvents ?? []).filter((candidate) => !prior.has(candidate.id))) {
    const type = transitionType(event);
    if (!type) continue;
    await snapshotForEvent({
      userId, project: after, event, type,
      ...(sourceId ? { sourceId } : {}),
      ...(event.primaryNodeId ? { nodeId: event.primaryNodeId } : {}),
      label,
      summary: event.summary,
      recorder,
    });
  }
}

async function uploadPdf(userId: string, projectId: string, document: RiversideHistoryDocument, bytes: Buffer): Promise<string> {
  if (!process.env.CLOUD_STORAGE_BUCKET?.trim()) throw new Error('CLOUD_STORAGE_BUCKET is required to create Riverside history PDFs.');
  const uploaded = await uploadContextSourcePdf({
    userId, sourceId: sourceIdFor(projectId, document), filename: document.filename,
    contentType: 'application/pdf', bytes,
  });
  if (!uploaded.storageUrl?.startsWith('gs://')) throw new Error(`Cloud Storage did not return a downloadable URL for ${document.filename}.`);
  return uploaded.storageUrl;
}

async function processDocument(userId: string, project: Project, document: RiversideHistoryDocument, recorder?: DeveloperGenerationRecorder): Promise<Project> {
  const bytes = pdfBytes(document);
  const sourceId = sourceIdFor(project.id, document);
  const storageUrl = await recordDeveloperGenerationStep(
    recorder,
    { name: 'Source uploaded', category: 'source', sourceId, filename: document.filename, summary: 'Uploaded the generated PDF to Cloud Storage.' },
    () => uploadPdf(userId, project.id, document, bytes),
  );
  const processed = await recordDeveloperGenerationStep(
    recorder,
    { name: 'Source processed by Context Agent', category: 'source', sourceId, filename: document.filename, summary: 'Processed the PDF through the Context Agent.' },
    async () => processContextSource(project, {
    sourceId, filename: document.filename, content: document.content, type: 'pdf', mimeType: 'application/pdf',
    sizeBytes: bytes.length, storageUrl, origin: 'user', hash: await hashText(`${document.filename}:${document.content}`),
    }, DEFAULT_USER_PROFILE, { captureProcessingLog: true }),
  );
  if (processed.error) throw new Error(processed.error);
  const refreshed = await refreshProjectGapRuntime({
    userId, project: processed.project, profile: DEFAULT_USER_PROFILE, memories: [],
    route: '/api/projects/riverside-history', label: `Riverside history demo · ${document.filename}`,
  });
  const nextProject = refreshed.project;
  const event = latestEvent(nextProject, 'context_added', (candidate) => candidate.sourceId === sourceId);
  if (!event) throw new Error(`Processing ${document.filename} did not create a context history event.`);
  await recordDeveloperGenerationStep(
    recorder,
    { name: 'Project saved', category: 'storage', summary: `Saved project state after ${document.filename}.` },
    () => getStorageProvider().saveProject(userId, nextProject),
  );
  const reloadedProject = await recordDeveloperGenerationStep(
    recorder,
    { name: 'Project reloaded', category: 'storage', summary: `Reloaded project state after ${document.filename}.` },
    () => getStorageProvider().getProject(userId, project.id),
  );
  const persistedProject = reloadedProject ?? nextProject;
  await snapshotNewEvents(userId, project, persistedProject, `${document.title} processed`, sourceId, recorder);
  return persistedProject;
}

function demoProposals(turn: string, assistantMessageId: string): AskContextProposal[] {
  return (RIVERSIDE_DEMO_PROPOSALS[turn] ?? []).map((proposal) => ({
    ...proposal,
    id: proposalIdFor(assistantMessageId, proposal),
    status: 'OPEN',
    sourceMessageId: assistantMessageId,
    confirmationStatus: 'pending',
  }));
}

interface RiversideAskTurn {
  project: Project;
  chat: AskChatSession;
  assistantMessageId: string;
  proposals: AskContextProposal[];
}

async function runAskTurn(params: { userId: string; project: Project; chat: AskChatSession; turn: string; message: string; recorder?: DeveloperGenerationRecorder }): Promise<RiversideAskTurn> {
  const storage = getStorageProvider();
  const now = new Date().toISOString();
  const userMessageId = askRecordId(params.project.id, params.turn, 'user');
  const assistantMessageId = askRecordId(params.project.id, params.turn, 'assistant');
  await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Ask user message persisted', category: 'ask', chatId: params.chat.id, messageId: userMessageId, summary: 'Persisted the Ask chat and user message.' },
    async () => {
      await storage.saveAskChat(params.userId, params.chat);
      await storage.saveAskMessage(params.userId, {
        id: userMessageId, chatId: params.chat.id, userId: params.userId, projectId: params.project.id,
        role: 'user', text: params.message, sources: [], createdAt: now,
      });
    },
  );
  const context = await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Ask context processed', category: 'ask', chatId: params.chat.id, messageId: userMessageId, summary: 'Processed the Ask message through the Context Agent.' },
    () => persistAskConversationContext({
    userId: params.userId, chatId: params.chat.id, messageId: userMessageId, text: params.message,
      projectId: params.project.id, captureProcessingLog: true,
    }),
  );
  const projectAfterContext = await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Project reloaded', category: 'storage', summary: 'Reloaded project state after Ask context processing.' },
    () => storage.getProject(params.userId, params.project.id),
  );
  if (!projectAfterContext) throw new Error('The Riverside Ask turn lost its project after context ingestion.');
  const liveResponse = await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Partner response completed', category: 'ask', chatId: params.chat.id, messageId: assistantMessageId, summary: 'Completed the Partner Agent response.' },
    () => askGapswise({
    userId: params.userId, message: params.message, projectId: params.project.id, chatId: params.chat.id,
    ...(params.chat.adkSessionId ? { sessionId: params.chat.adkSessionId } : {}),
    excludeMessageId: userMessageId, excludeSourceId: context.sourceId,
      openQuestions: context.openQuestions,
    }),
  );
  const proposals = demoProposals(params.turn, assistantMessageId);
  const response = { ...liveResponse, contextProposals: proposals, proposals } satisfies AskResult;
  await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Ask assistant message persisted', category: 'ask', chatId: params.chat.id, messageId: assistantMessageId, summary: 'Persisted the Partner Agent response.' },
    () => storage.saveAskMessage(params.userId, {
    id: assistantMessageId, chatId: params.chat.id, userId: params.userId, projectId: params.project.id,
    role: 'assistant', text: response.answer, sources: response.sources, createdAt: new Date().toISOString(),
    openQuestionIds: response.openQuestionIds ?? [], openQuestions: response.openQuestions ?? [],
    ...(response.outcome ? { outcome: response.outcome } : {}),
    ...(response.resolvesQuestionId ? { resolvesQuestionId: response.resolvesQuestionId } : {}),
    ...(response.conclusion ? { conclusion: response.conclusion } : {}),
    contextProposals: proposals, proposals,
    ...(response.searchSuggestions ? { searchSuggestions: response.searchSuggestions } : {}),
      ...(response.execution ? { execution: response.execution } : {}),
    }),
  );
  const chat = { ...params.chat, ...(response.sessionId ? { adkSessionId: response.sessionId } : {}), updatedAt: new Date().toISOString() } satisfies AskChatSession;
  await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Ask chat updated', category: 'ask', chatId: chat.id, summary: 'Updated the Ask chat session.' },
    () => storage.saveAskChat(params.userId, chat),
  );
  let nextProject = projectAfterContext;
  let event = (nextProject.historyEvents ?? []).find((candidate) => candidate.id === context.historyEventId);
  if (!event) {
    event = {
      id: boundedId('history', `${params.project.id}:ask:${params.turn}`), projectId: params.project.id,
      createdAt: new Date().toISOString(), type: 'context_changed', title: `Ask conversation · ${params.turn}`,
      summary: `Recorded the Ask conversation: ${params.message}`,
    };
    nextProject = { ...nextProject, historyEvents: [...(nextProject.historyEvents ?? []), event], updated_at: event.createdAt };
    await recordDeveloperGenerationStep(
      params.recorder,
      { name: 'Project saved', category: 'storage', summary: 'Saved the Ask conversation history event.' },
      () => storage.saveProject(params.userId, nextProject),
    );
  }
  await snapshotForEvent({
    userId: params.userId, project: nextProject, event, type: 'ask_response_created', askMessageId: assistantMessageId,
    label: `Ask response · ${params.turn}`, summary: response.answer.slice(0, 240),
    recorder: params.recorder,
  });
  return { project: nextProject, chat, assistantMessageId, proposals };
}

async function transitionProposal(params: { userId: string; turn: RiversideAskTurn; proposal: AskContextProposal; action: 'add' | 'dismiss'; recorder?: DeveloperGenerationRecorder }): Promise<Project> {
  const storage = getStorageProvider();
  const message = (await storage.getAskMessages(params.userId)).find((candidate) => candidate.id === params.turn.assistantMessageId);
  if (!message || !params.proposal.id) throw new Error('The Riverside proposal record was not found.');
  const nextProposal = { ...params.proposal, confirmationStatus: params.action === 'add' ? 'added' : 'dismissed' } satisfies AskContextProposal;
  const previousProposals = message.contextProposals ?? message.proposals ?? [];
  const nextProposals = previousProposals.map((candidate) => candidate.id === params.proposal.id ? nextProposal : candidate);
  await recordDeveloperGenerationStep(
    params.recorder,
    { name: params.action === 'add' ? 'Proposal added' : 'Proposal dismissed', category: 'proposal', chatId: message.chatId, messageId: message.id, proposalId: params.proposal.id, summary: `${params.action === 'add' ? 'Added' : 'Dismissed'} the Ask proposal.` },
    () => storage.saveAskMessage(params.userId, { ...message, contextProposals: nextProposals, proposals: nextProposals }),
  );
  let project = await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Project reloaded', category: 'storage', summary: 'Reloaded project state before applying the proposal transition.' },
    () => storage.getProject(params.userId, params.turn.project.id),
  ) ?? params.turn.project;
  if (params.action === 'add') {
    project = await recordDeveloperGenerationStep(
      params.recorder,
      { name: 'Proposal source processed', category: 'proposal', chatId: message.chatId, messageId: message.id, proposalId: params.proposal.id, sourceId: proposalSourceIdFor(message.id, params.proposal.id), summary: 'Persisted and processed the proposal as project context.' },
      () => persistAskProposal({ userId: params.userId, projectId: project.id, assistantMessageId: message.id, proposal: nextProposal }),
    );
  }
  const proposalId = params.proposal.id;
  const eventId = boundedId('history', `${project.id}:ask_proposal:${params.action}:${message.id}:${proposalId}`);
  const event: ProjectHistoryEvent = {
    id: eventId, projectId: project.id, createdAt: new Date().toISOString(),
    type: params.action === 'add' ? 'ask_proposal_added' : 'ask_proposal_dismissed',
    title: params.action === 'add' ? 'Ask suggestion added' : 'Ask suggestion dismissed', summary: nextProposal.text,
    ...(params.action === 'add' ? { sourceId: proposalSourceIdFor(message.id, proposalId) } : {}),
  };
  if (!project.historyEvents?.some((candidate) => candidate.id === event.id)) {
    project = { ...project, historyEvents: [...(project.historyEvents ?? []), event], updated_at: event.createdAt };
    await recordDeveloperGenerationStep(
      params.recorder,
      { name: 'Project saved', category: 'storage', summary: 'Saved the proposal transition.' },
      () => storage.saveProject(params.userId, project),
    );
  }
  if (params.action === 'add') {
    const contextEvent = latestEvent(project, 'context_added', (candidate) => candidate.sourceId === proposalSourceIdFor(message.id, proposalId));
    if (contextEvent) await snapshotForEvent({ userId: params.userId, project, event: contextEvent, type: 'context_processed', sourceId: contextEvent.sourceId, label: 'Ask proposal context processed', summary: contextEvent.summary, recorder: params.recorder });
  }
  await snapshotForEvent({
    userId: params.userId, project, event, type: params.action === 'add' ? 'ask_proposal_added' : 'ask_proposal_dismissed',
    askMessageId: message.id, proposalId, label: params.action === 'add' ? 'Ask proposal added' : 'Ask proposal dismissed', summary: nextProposal.text,
    recorder: params.recorder,
  });
  return project;
}

function findOpenNode(project: Project, type: ClarityNode['type'], pattern: RegExp): ClarityNode | undefined {
  return project.nodes.find((node) => node.status === 'OPEN' && node.type === type && pattern.test(node.text));
}

async function resolvePricingIfNeeded(userId: string, project: Project, recorder?: DeveloperGenerationRecorder): Promise<Project> {
  const decision = findOpenNode(project, 'DECISION', /price|pricing/i);
  if (!decision) return project;
  const updated = await recordDeveloperGenerationStep(
    recorder,
    { name: 'Decision resolved', category: 'resolution', summary: 'Confirmed the Riverside meal-price decision.' },
    () => confirmDecision(project, { decisionNodeId: decision.id, customDecision: 'Set the initial Riverside meal price at $14 per meal with delivery included.', reason: 'The price is within the range customers described and covers the current estimated delivery cost.' }),
  );
  await recordDeveloperGenerationStep(
    recorder,
    { name: 'Project saved', category: 'storage', summary: 'Saved the resolved Riverside meal-price decision.' },
    () => getStorageProvider().saveProject(userId, updated),
  );
  await snapshotNewEvents(userId, project, updated, 'Meal price decision confirmed', undefined, recorder);
  return updated;
}

async function resolveDriverQuestionIfNeeded(userId: string, project: Project, recorder?: DeveloperGenerationRecorder): Promise<Project> {
  const question = findOpenNode(project, 'UNKNOWN', /driver|delivery.*coverage|volunteer/i);
  if (!question) return project;
  const result = await recordDeveloperGenerationStep(
    recorder,
    { name: 'Question resolved', category: 'resolution', summary: 'Recorded confirmed delivery coverage.' },
    () => answerQuestion({ userId, projectId: project.id, nodeId: question.id, answer: 'Primary and backup volunteer drivers are confirmed for every Wednesday route.' }),
  );
  await snapshotNewEvents(userId, project, result.context, 'Delivery coverage question resolved', undefined, recorder);
  return result.context;
}

function projectInput(title: string) {
  return { name: title, goal: RIVERSIDE_HISTORY_DEMO_GOAL, deadline: RIVERSIDE_HISTORY_DEMO_DEADLINE };
}

export interface RiversideHistoryDemoResult {
  generationRunId: string;
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  created: true;
  fresh: boolean;
  snapshotCount: number;
  historyEventCount: number;
  finalNodeCount: number;
  finalEdgeCount: number;
  missingSnapshotEvents: Array<{ id: string; title: string; type: ProjectHistoryEvent['type'] }>;
  pdfs: Array<{ filename: string; sizeBytes: number; stored: boolean }>;
  chatCount: number;
  messageCount: number;
  addedProposalCount: number;
  dismissedProposalCount: number;
  pendingProposalCount: number;
  proposalCounts: {
    added: number;
    dismissed: number;
    pending: number;
  };
  graphHealth: ReturnType<typeof buildGraphHealthReport>;
  relationshipCountsByType: Partial<Record<EdgeType, number>>;
  pdfSourcesWithCompletionTrace: number;
  askProposalSourcesWithCompletionTrace: number;
}

export async function createRiversideHistoryDemoForUser(params: { userId: string; fresh?: boolean }): Promise<RiversideHistoryDemoResult> {
  const storage = getStorageProvider();
  const createdAt = new Date().toISOString();
  let project = createProjectFromInput(projectInput(RIVERSIDE_HISTORY_DEMO_TITLE), createdAt);
  const recorder = await startDeveloperGenerationRun({ userId: params.userId, projectId: project.id, generator: 'Riverside history demo' });
  try {
  await recorder.step({ name: 'Generation started', category: 'project', summary: 'Started a fresh Riverside history generation.' }, () => project);
  await recorder.step({ name: 'Project created in memory', category: 'project', summary: 'Created the Riverside project before persistence.' }, () => project);
  await recorder.step({ name: 'Initial project saved', category: 'storage', summary: 'Saved the new Riverside project.' }, () => storage.saveProject(params.userId, project));
  const started = latestEvent(project, 'project_started');
  if (!started) throw new Error('The Riverside history demo project has no project-started event.');
  await snapshotForEvent({ userId: params.userId, project, event: started, type: 'project_created', label: 'Project created', summary: 'The Riverside meal-delivery history demo project was created.', recorder });

  project = await processDocument(params.userId, project, RIVERSIDE_HISTORY_DOCUMENTS[0], recorder);
  const chat: AskChatSession = {
    id: boundedId('chat', `${project.id}:planning`), userId: params.userId, scopeType: 'project', projectId: project.id,
    title: 'Planning the Riverside pilot', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const validation = await runAskTurn({ userId: params.userId, project, chat, turn: 'validation', message: 'What should we validate before committing to the weekly Riverside launch?', recorder });
  project = await transitionProposal({ userId: params.userId, turn: validation, proposal: validation.proposals[0], action: 'add', recorder });
  project = await transitionProposal({ userId: params.userId, turn: { ...validation, project }, proposal: validation.proposals[1], action: 'add', recorder });
  project = await transitionProposal({ userId: params.userId, turn: { ...validation, project }, proposal: validation.proposals[2], action: 'dismiss', recorder });

  project = await processDocument(params.userId, project, RIVERSIDE_HISTORY_DOCUMENTS[1], recorder);
  const cancellations = await runAskTurn({ userId: params.userId, project, chat: validation.chat, turn: 'cancellations', message: 'What happens if volunteer drivers cancel on a Wednesday?', recorder });
  project = await transitionProposal({ userId: params.userId, turn: cancellations, proposal: cancellations.proposals[0], action: 'add', recorder });
  project = await transitionProposal({ userId: params.userId, turn: { ...cancellations, project }, proposal: cancellations.proposals[1], action: 'dismiss', recorder });

  project = await processDocument(params.userId, project, RIVERSIDE_HISTORY_DOCUMENTS[2], recorder);
  const pricing = await runAskTurn({ userId: params.userId, project, chat: cancellations.chat, turn: 'pricing', message: 'What must be confirmed before setting the Riverside meal price?', recorder });
  project = await transitionProposal({ userId: params.userId, turn: pricing, proposal: pricing.proposals[0], action: 'add', recorder });
  project = await transitionProposal({ userId: params.userId, turn: { ...pricing, project }, proposal: pricing.proposals[1], action: 'dismiss', recorder });

  project = await processDocument(params.userId, project, RIVERSIDE_HISTORY_DOCUMENTS[3], recorder);
  project = await resolveDriverQuestionIfNeeded(params.userId, project, recorder);
  project = await resolvePricingIfNeeded(params.userId, project, recorder);
  project = await processDocument(params.userId, project, RIVERSIDE_HISTORY_DOCUMENTS[4], recorder);
  project = await resolvePricingIfNeeded(params.userId, project, recorder);

  const snapshots = await storage.listProjectSnapshots(params.userId, project.id);
  const messages = (await storage.getAskMessages(params.userId)).filter((message) => message.projectId === project.id);
  const chats = (await storage.getAskChats(params.userId)).filter((item) => item.projectId === project.id);
  const proposals = messages.flatMap((message) => normalizeAskContextProposals(message.contextProposals ?? message.proposals));
  const missingSnapshotEvents = (project.historyEvents ?? [])
    .filter((event) => !snapshots.some((snapshot) => snapshot.trigger.historyEventId === event.id))
    .map((event) => ({ id: event.id, title: event.title, type: event.type }));
  const pdfs = RIVERSIDE_HISTORY_DOCUMENTS.map((document) => {
    const source = project.sources.find((candidate) => candidate.id === sourceIdFor(project.id, document));
    return { filename: document.filename, sizeBytes: source?.size_bytes ?? pdfBytes(document).length, stored: Boolean(source?.storage_url?.startsWith('gs://')) };
  });
  const addedProposalCount = proposals.filter((proposal) => proposal.confirmationStatus === 'added').length;
  const dismissedProposalCount = proposals.filter((proposal) => proposal.confirmationStatus === 'dismissed').length;
  const pendingProposalCount = proposals.filter((proposal) => !proposal.confirmationStatus || proposal.confirmationStatus === 'pending' || proposal.confirmationStatus === 'proposed').length;
  if (missingSnapshotEvents.length > 0) {
    throw new Error(`Riverside history demo has history events without exact snapshots: ${missingSnapshotEvents.map((event) => `${event.id}:${event.type}`).join(', ')}`);
  }
  if (pdfs.some((pdf) => !pdf.stored)) {
    throw new Error('Riverside history demo did not store every required PDF as a downloadable asset.');
  }
  if (addedProposalCount !== 4 || dismissedProposalCount !== 3 || pendingProposalCount !== 0) {
    throw new Error(`Riverside history demo expected 4 added, 3 dismissed, and 0 pending proposals, got ${addedProposalCount}, ${dismissedProposalCount}, and ${pendingProposalCount}.`);
  }
  if (!project.nodes.some((node) => node.type === 'DECISION' && node.status === 'RESOLVED' && /price|pricing/i.test(node.text))) {
    throw new Error('Riverside history demo final state is missing its resolved meal-price decision.');
  }
  if (!project.nodes.some((node) => node.type === 'UNKNOWN' && node.status === 'RESOLVED' && /driver|delivery.*coverage|volunteer/i.test(node.text))) {
    throw new Error('Riverside history demo final state is missing resolved delivery coverage.');
  }
  if (!project.nodes.some((node) => node.type === 'UNKNOWN' && node.status === 'OPEN' && /packing-and-delivery rehearsal/i.test(node.text))) {
    throw new Error('Riverside history demo final state is missing its open packing-and-delivery rehearsal blocker.');
  }
  const assertUniqueIds = (kind: string, ids: string[]) => {
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length > 0) throw new Error(`Riverside history demo contains duplicate ${kind} IDs: ${[...new Set(duplicates)].join(', ')}`);
  };
  assertUniqueIds('node', project.nodes.map((node) => node.id));
  assertUniqueIds('edge', project.edges.map((edge) => edge.id));
  assertUniqueIds('source', project.sources.map((source) => source.id));
  assertUniqueIds('history event', (project.historyEvents ?? []).map((event) => event.id));
  assertUniqueIds('chat', chats.map((chat) => chat.id));
  assertUniqueIds('message', messages.map((message) => message.id));
  assertUniqueIds('proposal', proposals.map((proposal) => proposal.id).filter((id): id is string => Boolean(id)));
  const relationshipCountsByType = project.edges.reduce<Partial<Record<EdgeType, number>>>((counts, edge) => { counts[edge.type] = (counts[edge.type] ?? 0) + 1; return counts; }, {});
  const hasCompletionTrace = (source: Project['sources'][number]) => Boolean(source.processing_log?.stages.some((stage) => stage.name === 'Relationship completion'));
  const graphHealth = buildGraphHealthReport(project);
  const scope: AppScope = { type: 'project', projectId: project.id };
  await recorder.step({ name: 'Final project validation', category: 'validation', summary: 'Validated the completed Riverside history project and its snapshots.' }, () => undefined);
  await recorder.step({ name: 'Active project/scope selected', category: 'project', summary: 'Selected the generated Riverside project as the active scope.' }, () => storage.setAppScope(params.userId, scope));
  const result: RiversideHistoryDemoResult = {
    generationRunId: recorder.run.id,
    project, projects: await storage.listProjects(params.userId), activeProjectId: project.id, scope,
    created: true, fresh: Boolean(params.fresh), snapshotCount: snapshots.length, historyEventCount: project.historyEvents?.length ?? 0,
    finalNodeCount: project.nodes.length, finalEdgeCount: project.edges.length, missingSnapshotEvents, pdfs,
    chatCount: chats.length, messageCount: messages.length,
    addedProposalCount, dismissedProposalCount, pendingProposalCount,
    proposalCounts: { added: addedProposalCount, dismissed: dismissedProposalCount, pending: pendingProposalCount },
    graphHealth, relationshipCountsByType,
    pdfSourcesWithCompletionTrace: project.sources.filter((source) => source.type === 'pdf' && hasCompletionTrace(source)).length,
    askProposalSourcesWithCompletionTrace: project.sources.filter((source) => source.id.startsWith('ask_proposal_') && hasCompletionTrace(source)).length,
  };
  await recorder.step({ name: 'Generation completed', category: 'validation', summary: 'Completed the Riverside history generation.' }, () => undefined);
  await recorder.complete();
  return result;
  } catch (error) {
    try {
      await recorder.fail(error);
    } catch {
      // Preserve the generation error if diagnostic persistence is unavailable.
    }
    throw attachDeveloperGenerationError(error, recorder);
  }
}
