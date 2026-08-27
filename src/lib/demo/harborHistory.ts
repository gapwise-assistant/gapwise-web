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

export const HARBOR_HISTORY_DEMO_TITLE = 'Harbor Pilot — History Demo';
export const HARBOR_HISTORY_DEMO_GOAL =
  'Launch Harbor’s 500-ticket customer-support pilot by November 1, 2026, with security approval, procurement, integration scope, pricing, staffing, and operational readiness confirmed.';
export const HARBOR_HISTORY_DEMO_DEADLINE = '2026-11-01';

interface HarborHistoryDocument {
  slug: string;
  filename: string;
  title: string;
  preparedBy: string;
  date: string;
  content: string;
}

/**
 * These are source documents, not graph fixtures. The body is the text a PDF
 * extractor would provide to Context Agent, while pdfBytes() creates the
 * corresponding valid PDF asset for storage when Cloud Storage is configured.
 */
export const HARBOR_HISTORY_DOCUMENTS: readonly HarborHistoryDocument[] = [
  {
    slug: 'pilot-brief',
    filename: 'Harbor Pilot Brief.pdf',
    title: 'Harbor Customer-Support Pilot Brief',
    preparedBy: 'Maya Chen, Harbor Pilot Lead',
    date: 'August 18, 2026',
    content: `Harbor Customer-Support Pilot Brief

Prepared by: Maya Chen, Harbor Pilot Lead
Date: August 18, 2026
Version: 1.0

Pilot summary
Harbor wants a 500-ticket customer-support pilot with a target launch date of November 1, 2026. The pilot should demonstrate a 12% reduction in average resolution time while staying within the budget ceiling of $45,000.

| Measure | Pilot target |
| Launch target | November 1, 2026 |
| Ticket volume | 500 support tickets |
| Resolution-time improvement | 12% reduction |
| Budget ceiling | $45,000 |

This brief establishes the outcome measures and commercial boundary for the pilot. The pilot will run for eight weeks. Security approval, procurement, technical integration, pricing, staffing, and launch readiness remain unresolved before the target date.`,
  },
  {
    slug: 'security-requirements',
    filename: 'Harbor Security Requirements.pdf',
    title: 'Harbor Security and Data Requirements',
    preparedBy: 'Jordan Ellis, Harbor Security',
    date: 'August 20, 2026',
    content: `Harbor Security and Data Requirements

Prepared by: Jordan Ellis, Harbor Security
Date: August 20, 2026
Version: 1.0

Security requirements
Security approval is required before procurement can issue the purchase order. Customer data must be deleted within 30 days after the pilot ends. The pilot must also have an annual penetration test on record.

| Requirement | Current status |
| Customer data deletion | Must complete within 30 days |
| Security approval | Required before procurement |
| Penetration test | Annual test required |

The current penetration-test report is 14 months old. Harbor requires a refreshed security package and approval before the procurement gate can be cleared.

Open question: Has engineering confirmed that the pilot system can enforce deletion of customer data within 30 days?`,
  },
  {
    slug: 'engineering-review',
    filename: 'Engineering Integration Review.pdf',
    title: 'Engineering Integration Review',
    preparedBy: 'Priya Nair, Engineering',
    date: 'August 22, 2026',
    content: `Engineering Integration Review

Prepared by: Priya Nair, Engineering
Date: August 22, 2026
Version: 1.0

Technical scope
The team can deliver a nightly CSV integration in two weeks. A custom API integration would require six weeks. The project has not yet selected which technical integration to use for the pilot.

| Option | Estimated delivery |
| Nightly CSV integration | Two weeks |
| Custom API integration | Six weeks |

Engineering has not confirmed that the pilot system can support the required 30-day customer-data deletion policy. The estimated support load for the pilot is 20 to 30 hours.

Open decision: Choose the technical integration for the Harbor pilot. Open question: Can engineering support deletion of customer data within 30 days?`,
  },
  {
    slug: 'procurement-email',
    filename: 'Harbor Procurement Update.pdf',
    title: 'Harbor Procurement Update',
    preparedBy: 'Elena Ruiz, Harbor Procurement',
    date: 'August 25, 2026',
    content: `Harbor Procurement Update

From: Elena Ruiz, Harbor Procurement
To: Harbor Pilot Team
Date: August 25, 2026
Subject: Security approval and purchase order timing
Version: 1.0

Final pilot pricing is proposed at $38,500 but remains awaiting approval. Procurement cannot issue the purchase order until security approval is recorded. Harbor's commercial approver is away until Monday, and missing Friday approval may delay the November 1 launch target.

| Procurement item | Current status |
| Security approval | Required before purchase order |
| Final pilot pricing | Proposed at $38,500; unconfirmed |
| Harbor approver | Away until Monday |
| Friday approval | Missing it may delay launch |

Please keep the security package and final pricing ready for approval when the approver returns. The pricing amount is a proposal, not a confirmed decision.

Open decision: Approve the final pilot price for Harbor after the commercial approver reviews the proposal.`,
  },
  {
    slug: 'final-readiness',
    filename: 'Harbor Launch Readiness Report.pdf',
    title: 'Harbor Pilot Launch Readiness Report',
    preparedBy: 'Maya Chen, Harbor Pilot Lead',
    date: 'September 2, 2026',
    content: `Harbor Pilot Launch Readiness Report

Prepared by: Maya Chen, Harbor Pilot Lead
Date: September 2, 2026
Version: 1.0

Final readiness status
The Harbor pilot will use the nightly CSV integration, and that technical scope is confirmed. Harbor security approved the refreshed penetration-test report. Engineering confirmed that customer data can be deleted within 30 days after the pilot.

| Readiness item | Final status |
| Technical integration | Nightly CSV selected and confirmed |
| Security | Refreshed penetration test approved |
| Data deletion | 30-day deletion confirmed by Engineering |
| Pilot price | Approved at $38,500 |
| Procurement | Purchase order issued |
| Support | Support owner: Marcus Lee |
| Training | Scheduled for October 28 |
| Production access | Final rehearsal not yet completed |

The 500-ticket scope, 12% resolution-time target, and $45,000 budget ceiling remain the operating boundaries. The final production access rehearsal has not yet been completed and must be completed before launch authorization.`,
  },
];

export interface HarborHistoryDemoResult {
  generationRunId: string;
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  created: boolean;
  fresh: boolean;
  snapshotCount: number;
  historyEventCount: number;
  finalNodeCount: number;
  finalEdgeCount: number;
  missingSnapshotEvents: Array<{ id: string; title: string; type: ProjectHistoryEvent['type'] }>;
  pdfs: Array<{ filename: string; sizeBytes: number; stored: boolean }>;
  projectTitle: string;
  chatCount: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  addedProposalCount: number;
  dismissedProposalCount: number;
  pendingProposalCount: number;
  proposalCounts: {
    added: number;
    dismissed: number;
    pending: number;
  };
  uniqueSnapshotEventCount: number;
  askResponseSnapshotCount: number;
  proposalAddedSnapshotCount: number;
  proposalDismissedSnapshotCount: number;
  snapshotsWithFocus: number;
  snapshotsWithOverview: number;
  snapshotsWithToday: number;
  downloadablePdfCount: number;
  finalOpenQuestions: Array<{ id: string; type: ClarityNode['type']; text: string }>;
  graphHealth: ReturnType<typeof buildGraphHealthReport>;
  relationshipCountsByType: Partial<Record<EdgeType, number>>;
  pdfSourcesWithCompletionTrace: number;
  askProposalSourcesWithCompletionTrace: number;
}

function pdfEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7e]/g, '?');
}

function wrappedLines(value: string, width = 94): string[] {
  return value.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [''];
    const words = line.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (next.length > width && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    });
    if (current) lines.push(current);
    return lines;
  });
}

function pdfPageContent(lines: string[], pageNumber: number, pageCount: number): string {
  const [firstLine = '', ...remainingLines] = lines;
  return [
    'BT',
    '/F1 16 Tf',
    '72 748 Td',
    `(${pdfEscape(firstLine)}) Tj`,
    '/F1 9 Tf',
    '0 -20 Td',
    ...remainingLines.flatMap((line) => [
      `(${pdfEscape(line)}) Tj`,
      '0 -13 Td',
    ]),
    'ET',
    'BT',
    '/F1 8 Tf',
    '72 28 Td',
    `(${pdfEscape(`Page ${pageNumber} of ${pageCount}`)}) Tj`,
    'ET',
  ].join('\n');
}

/** Creates valid, bounded PDF pages without adding a PDF dependency. */
function pdfBytes(document: HarborHistoryDocument): Buffer {
  const lines = wrappedLines(document.content);
  const linesPerPage = 48;
  const pageLines = Array.from({ length: Math.max(1, Math.ceil(lines.length / linesPerPage)) }, (_, index) =>
    lines.slice(index * linesPerPage, (index + 1) * linesPerPage),
  );
  const pageCount = pageLines.length;
  const pageObjectStart = 3;
  const fontObjectId = pageObjectStart + pageCount;
  const contentObjectStart = fontObjectId + 1;
  const pageObjectIds = pageLines.map((_, index) => pageObjectStart + index);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...pageLines.map((_, index) => {
      const contentObjectId = contentObjectStart + index;
      return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pageLines.map((page, index) => {
      const commands = pdfPageContent(page, index + 1, pageCount);
      return `<< /Length ${Buffer.byteLength(commands, 'ascii')} >>\nstream\n${commands}\nendstream`;
    }),
  ];
  let output = '%PDF-1.4\n%Gapwise\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, 'ascii'));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output, 'ascii');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'ascii');
}

function projectInput(title: string) {
  return {
    name: title,
    goal: HARBOR_HISTORY_DEMO_GOAL,
    deadline: HARBOR_HISTORY_DEMO_DEADLINE,
  };
}

function sourceIdFor(projectId: string, document: HarborHistoryDocument): string {
  return boundedId('source', `${projectId}_${document.slug}`);
}

function latestEvent(
  project: Project,
  type: ProjectHistoryEvent['type'],
  predicate?: (event: ProjectHistoryEvent) => boolean,
): ProjectHistoryEvent | undefined {
  return [...(project.historyEvents ?? [])]
    .reverse()
    .find((event) => event.type === type && (!predicate || predicate(event)));
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
    {
      name: 'History snapshot saved',
      category: 'snapshot',
      historyEventId: params.event.id,
      ...(params.sourceId ? { sourceId: params.sourceId } : {}),
      ...(params.askMessageId ? { messageId: params.askMessageId } : {}),
      ...(params.proposalId ? { proposalId: params.proposalId } : {}),
      summary: params.label,
    },
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
  if (snapshot.trigger.type !== params.type) {
    throw new Error(`Snapshot for ${params.label} used trigger ${snapshot.trigger.type}, expected ${params.type}.`);
  }
  if (snapshot.trigger.historyEventId !== params.event.id) {
    throw new Error(`Snapshot for ${params.label} is not linked to history event ${params.event.id}.`);
  }
  if (params.sourceId && snapshot.trigger.sourceId !== params.sourceId) {
    throw new Error(`Snapshot for ${params.label} is not linked to source ${params.sourceId}.`);
  }
  if (params.nodeId && snapshot.trigger.nodeId !== params.nodeId) {
    throw new Error(`Snapshot for ${params.label} is not linked to node ${params.nodeId}.`);
  }
  if (params.askMessageId && snapshot.trigger.askMessageId !== params.askMessageId) {
    throw new Error(`Snapshot for ${params.label} is not linked to Ask message ${params.askMessageId}.`);
  }
  if (params.proposalId && snapshot.trigger.proposalId !== params.proposalId) {
    throw new Error(`Snapshot for ${params.label} is not linked to proposal ${params.proposalId}.`);
  }
  return snapshot;
}

function snapshotTriggerTypeFor(event: ProjectHistoryEvent): 'context_processed' | 'decision_confirmed' | 'gap_resolved' | null {
  if (event.type === 'context_added') return 'context_processed';
  if (event.type === 'decision_resolved') return 'decision_confirmed';
  if (event.type === 'gap_resolved') return 'gap_resolved';
  return null;
}

async function uploadPdfIfConfigured(
  userId: string,
  projectId: string,
  document: HarborHistoryDocument,
  bytes: Buffer,
): Promise<string> {
  if (!process.env.CLOUD_STORAGE_BUCKET?.trim()) {
    throw new Error('CLOUD_STORAGE_BUCKET is required to create downloadable Harbor history PDFs.');
  }
  const uploaded = await uploadContextSourcePdf({
    userId,
    sourceId: sourceIdFor(projectId, document),
    filename: document.filename,
    contentType: 'application/pdf',
    bytes,
  });
  if (!uploaded.storageUrl?.trim()) {
    throw new Error(`Cloud Storage did not return a downloadable URL for ${document.filename}.`);
  }
  return uploaded.storageUrl;
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
    // A newly created project can contain only its GOAL, so the normal Focus
    // service has no actionable candidate yet. Preserve a useful historical
    // assessment for that exact starting moment without changing Focus rules.
    const goal = project.nodes.find((node) => node.type === 'GOAL');
    const initialFocus: FocusAssessment = {
      kind: 'discovery',
      title: goal?.text ?? project.goal,
      representedNodeIds: goal ? [goal.id] : [],
      sourceNodeIds: goal ? [goal.id] : [],
      sourceIds: [],
      ...(goal ? { targetNodeId: goal.id, actionNodeId: goal.id } : {}),
      score: 0,
      confidence: 1,
    };
    const projectStateVersion = await focusProjectStateVersion(project, contextPack, DEFAULT_USER_PROFILE);
    const now = new Date().toISOString();
    await recordDeveloperGenerationStep(
      recorder,
      { name: 'Focus assessment obtained', category: 'assessment', summary: 'Saved the starting Focus assessment.' },
      () => storage.saveFocusAssessment(userId, {
        id: focusAssessmentCacheId(project.id, projectStateVersion),
        userId,
        projectId: project.id,
        projectStateVersion,
        assessment: initialFocus,
        createdAt: now,
        updatedAt: now,
      }),
    );
    focus = initialFocus;
  }
  try {
    await recordDeveloperGenerationStep(
      recorder,
      { name: 'Overview assessment obtained', category: 'assessment', summary: 'Loaded the current Overview assessment.' },
      () => getProjectOverviewAssessmentWithMetadata(userId, project, project.historyEvents ?? [], focus, contextPack),
    );
  } catch {
    // A malformed model assessment must not prevent the historical Harbor
    // journey from producing a reproducible snapshot. This fallback is
    // limited to the demo's persisted assessment and stays grounded in the
    // current canonical project state.
    const openItems = project.nodes
      .filter((node) => node.status === 'OPEN' && ['DECISION', 'UNKNOWN', 'ASSUMPTION', 'RISK'].includes(node.type))
      .slice(0, 3);
    const assessment: ProjectOverviewAssessment = {
      trajectory: {
        state: openItems.length ? 'taking_shape' : 'moving_forward',
        explanation: `The project currently has ${openItems.length} important open item${openItems.length === 1 ? '' : 's'}.`,
      },
      summary: `${project.title} is progressing toward its launch goal while the remaining open items are worked through.`,
      meaningfulChanges: [],
      goalImpact: {
        summary: 'The current project state is grounded in the recorded goal, context, and decisions.',
        positiveFactors: [],
        negativeFactors: [],
      },
      unsettled: openItems.map((node) => ({
        title: node.text,
        explanation: 'This item remains open in the project graph.',
        sourceNodeIds: [node.id],
      })),
      criticalIssues: [],
      emergingInsights: [],
      confidence: 0.5,
    };
    const projectStateVersion = await overviewProjectStateVersion(
      project,
      project.historyEvents ?? [],
      focus,
      contextPack,
    );
    const now = new Date().toISOString();
    await recordDeveloperGenerationStep(
      recorder,
      { name: 'Overview assessment obtained', category: 'assessment', summary: 'Saved the grounded Overview assessment.' },
      () => storage.saveProjectOverviewAssessment(userId, {
        id: projectOverviewAssessmentCacheId(project.id, projectStateVersion),
        userId,
        projectId: project.id,
        projectStateVersion,
        assessment,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  await recordDeveloperGenerationStep(
    recorder,
    { name: 'Today state obtained', category: 'assessment', summary: 'Generated the current Today brief.' },
    () => generateDailyBrief({ userId, project, memories, contextPack, force: false }),
  );
}

async function processDocument(userId: string, project: Project, document: HarborHistoryDocument, recorder?: DeveloperGenerationRecorder): Promise<Project> {
  const sourceId = sourceIdFor(project.id, document);
  const existing = project.sources.find((source) => source.id === sourceId);
  const existingEvent = latestEvent(project, 'context_added', (event) => event.sourceId === sourceId);
  if (existing?.processing_status === 'completed') {
    if (!existingEvent) {
      throw new Error(`The existing Harbor source ${document.filename} has no context history event.`);
    }
    return project;
  }

  const bytes = pdfBytes(document);
  const storageUrl = await recordDeveloperGenerationStep(
    recorder,
    {
      name: 'Source uploaded',
      category: 'source',
      sourceId,
      filename: document.filename,
      summary: 'Uploaded the generated PDF to Cloud Storage.',
    },
    () => uploadPdfIfConfigured(userId, project.id, document, bytes),
  );
  const processed = await recordDeveloperGenerationStep(
    recorder,
    {
      name: 'Source processed by Context Agent',
      category: 'source',
      sourceId,
      filename: document.filename,
      summary: 'Processed the PDF through the Context Agent.',
    },
    async () => processContextSource(project, {
      sourceId,
      filename: document.filename,
      content: document.content,
      type: 'pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      storageUrl,
      origin: 'user',
      hash: await hashText(`${document.filename}:${document.content}`),
    }, DEFAULT_USER_PROFILE, {
      forceReprocess: Boolean(existing),
      captureProcessingLog: true,
    }),
  );
  if (processed.error) throw new Error(processed.error);

  const refreshed = await refreshProjectGapRuntime({
    userId,
    project: processed.project,
    profile: DEFAULT_USER_PROFILE,
    memories: [],
    route: '/api/projects/harbor-history-demo',
    label: `Harbor history demo · ${document.filename}`,
  });
  const nextProject = refreshed.project;
  const priorEventIds = new Set((project.historyEvents ?? []).map((event) => event.id));
  const newEvents = (nextProject.historyEvents ?? []).filter((event) => !priorEventIds.has(event.id));
  const event = newEvents.find((candidate) => candidate.type === 'context_added' && candidate.sourceId === sourceId)
    ?? latestEvent(nextProject, 'context_added', (candidate) => candidate.sourceId === sourceId);
  if (!event) {
    throw new Error(`Processing ${document.filename} did not create a meaningful context history event.`);
  }
  await recordDeveloperGenerationStep(
    recorder,
    {
      name: 'Project saved',
      category: 'storage',
      summary: `Saved project state after ${document.filename}.`,
    },
    () => getStorageProvider().saveProject(userId, nextProject),
  );
  const reloadedProject = await recordDeveloperGenerationStep(
    recorder,
    {
      name: 'Project reloaded',
      category: 'storage',
      summary: `Reloaded project state after ${document.filename}.`,
    },
    () => getStorageProvider().getProject(userId, project.id),
  );
  const persistedProject = reloadedProject ?? nextProject;
  for (const historyEvent of newEvents) {
    const type = snapshotTriggerTypeFor(historyEvent);
    if (!type) continue;
    await snapshotForEvent({
      userId,
      project: nextProject,
      event: historyEvent,
      type,
      ...(historyEvent.type === 'context_added' ? { sourceId } : {}),
      ...(historyEvent.primaryNodeId ? { nodeId: historyEvent.primaryNodeId } : {}),
      label: historyEvent.type === 'gap_resolved'
        ? 'Question resolved during final readiness update'
        : historyEvent.type === 'decision_resolved'
          ? 'Decision resolved during final readiness update'
          : `${document.title} processed`,
      summary: historyEvent.type === 'context_added'
        ? `Processed ${document.filename} through the Context Agent.`
        : historyEvent.summary,
      recorder,
    });
  }
  return persistedProject;
}

function openTechnicalDecision(project: Project): ClarityNode | undefined {
  return project.nodes.find((node) => {
    const text = node.text.toLowerCase();
    return node.type === 'DECISION'
      && node.status === 'OPEN'
      && text.includes('integration')
      && (text.includes('technical') || text.includes('pilot') || text.includes('scope'));
  });
}

function technicalDecision(project: Project): ClarityNode | undefined {
  return project.nodes.find((node) => {
    const text = node.text.toLowerCase();
    return node.type === 'DECISION'
      && text.includes('integration')
      && (text.includes('technical') || text.includes('pilot') || text.includes('scope'));
  });
}

function openDeletionQuestion(project: Project): ClarityNode | undefined {
  return project.nodes.find((node) => {
    const text = node.text.toLowerCase();
    return (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
      && node.status === 'OPEN'
      && text.includes('30')
      && (text.includes('delet') || text.includes('data'));
  });
}

function deletionQuestion(project: Project): ClarityNode | undefined {
  return project.nodes.find((node) => {
    const text = node.text.toLowerCase();
    return (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
      && text.includes('30')
      && (text.includes('delet') || text.includes('data'));
  });
}

async function resolveTechnicalDecision(userId: string, project: Project, recorder?: DeveloperGenerationRecorder): Promise<Project> {
  const decision = openTechnicalDecision(project);
  if (!decision) {
    const existing = technicalDecision(project);
    if (existing?.status === 'RESOLVED') return project;
    throw new Error('The Harbor history demo could not find the open technical integration decision.');
  }
  const updated = await recordDeveloperGenerationStep(
    recorder,
    { name: 'Decision resolved', category: 'resolution', summary: 'Confirmed the technical integration decision.' },
    () => confirmDecision(project, {
      decisionNodeId: decision.id,
      customDecision: 'Use the nightly CSV integration for the pilot and defer the custom API until after the pilot.',
      reason: 'The CSV path fits the pilot timeline and preserves the longer API integration for a later phase.',
    }),
  );
  await recordDeveloperGenerationStep(
    recorder,
    { name: 'Project saved', category: 'storage', summary: 'Saved the resolved technical decision.' },
    () => getStorageProvider().saveProject(userId, updated),
  );
  const reloaded = await recordDeveloperGenerationStep(
    recorder,
    { name: 'Project reloaded', category: 'storage', summary: 'Reloaded the project after resolving the technical decision.' },
    () => getStorageProvider().getProject(userId, project.id),
  );
  const persisted = reloaded ?? updated;
  const event = latestEvent(persisted, 'decision_resolved', (candidate) => candidate.primaryNodeId === decision.id);
  if (!event) throw new Error('The technical decision was updated without a decision history event.');
  await snapshotForEvent({
    userId,
    project: persisted,
    event,
    type: 'decision_confirmed',
    nodeId: decision.id,
    label: 'Technical integration decision confirmed',
    summary: persisted.nodes.find((node) => node.id === decision.id)?.decision_outcome,
    recorder,
  });
  return persisted;
}

async function resolveDeletionQuestion(userId: string, project: Project, recorder?: DeveloperGenerationRecorder): Promise<Project> {
  const question = openDeletionQuestion(project);
  if (!question) {
    const existing = deletionQuestion(project);
    if (existing?.status === 'RESOLVED') return project;
    throw new Error('The Harbor history demo could not find the open 30-day deletion question.');
  }
  const result = await recordDeveloperGenerationStep(
    recorder,
    { name: 'Question resolved', category: 'resolution', summary: 'Recorded the confirmed 30-day deletion answer.' },
    () => answerQuestion({
      userId,
      projectId: project.id,
      nodeId: question.id,
      answer: 'Engineering confirmed that Harbor pilot customer data can be automatically deleted within 30 days after the pilot.',
    }),
  );
  const updated = result.context;
  const event = latestEvent(updated, 'gap_resolved', (candidate) => candidate.primaryNodeId === question.id);
  if (!event) throw new Error('The deletion question was answered without a question history event.');
  await snapshotForEvent({
    userId,
    project: updated,
    event,
    type: 'gap_resolved',
    nodeId: question.id,
    label: '30-day deletion question resolved',
    summary: 'Engineering confirmed the required deletion support.',
    recorder,
  });
  return updated;
}

function openPricingDecision(project: Project): ClarityNode | undefined {
  return project.nodes.find((node) => {
    const text = node.text.toLowerCase();
    return node.type === 'DECISION'
      && node.status === 'OPEN'
      && (text.includes('price') || text.includes('pricing'))
      && (text.includes('pilot') || text.includes('harbor') || text.includes('approve'));
  });
}

function pricingDecision(project: Project): ClarityNode | undefined {
  return project.nodes.find((node) => {
    const text = node.text.toLowerCase();
    return node.type === 'DECISION'
      && (text.includes('price') || text.includes('pricing'))
      && (text.includes('pilot') || text.includes('harbor') || text.includes('approve'));
  });
}

async function resolvePricingDecision(userId: string, project: Project, recorder?: DeveloperGenerationRecorder): Promise<Project> {
  const decision = openPricingDecision(project);
  if (!decision) {
    const existing = pricingDecision(project);
    if (existing?.status === 'RESOLVED') return project;
    throw new Error('The Harbor history demo could not find the open pricing decision.');
  }
  const updated = await recordDeveloperGenerationStep(
    recorder,
    { name: 'Decision resolved', category: 'resolution', summary: 'Confirmed the final pilot pricing decision.' },
    () => confirmDecision(project, {
      decisionNodeId: decision.id,
      customDecision: 'Approve the Harbor pilot price at $38,500.',
      reason: 'The amount is below the $45,000 budget ceiling and covers the confirmed CSV scope and expected support effort.',
    }),
  );
  await recordDeveloperGenerationStep(
    recorder,
    { name: 'Project saved', category: 'storage', summary: 'Saved the resolved pricing decision.' },
    () => getStorageProvider().saveProject(userId, updated),
  );
  const event = latestEvent(updated, 'decision_resolved', (candidate) => candidate.primaryNodeId === decision.id);
  if (!event) throw new Error('The pricing decision was updated without a decision history event.');
  await snapshotForEvent({
    userId,
    project: updated,
    event,
    type: 'decision_confirmed',
    nodeId: decision.id,
    label: 'Pilot pricing decision confirmed',
    summary: updated.nodes.find((node) => node.id === decision.id)?.decision_outcome,
    recorder,
  });
  return updated;
}

export function askRecordId(projectId: string, turn: string, role: 'user' | 'assistant'): string {
  return boundedId('ask', `${projectId}_${turn}_${role}`);
}

export function proposalIdFor(assistantMessageId: string, proposal: HarborDemoProposalSpec): string {
  return boundedId('proposal', `${assistantMessageId}_${proposal.type}_${proposal.text}`);
}

export function proposalSourceIdFor(assistantMessageId: string, proposalId: string): string {
  return boundedId('ask_proposal', `${assistantMessageId}_${proposalId}`);
}

interface HarborDemoProposalSpec {
  type: AskContextProposal['type'];
  text: string;
}

const HARBOR_DEMO_PROPOSALS: Record<string, readonly HarborDemoProposalSpec[]> = {
  planning: [
    {
      type: 'UNKNOWN',
      text: 'Confirm whether Harbor requires security approval before procurement can issue the purchase order.',
    },
    {
      type: 'ASSUMPTION',
      text: 'Expand the pilot from 500 to 1,000 tickets.',
    },
  ],
  'security-impact': [
    {
      type: 'NEXT_ACTION',
      text: 'Obtain written confirmation from engineering about 30-day deletion support.',
    },
    {
      type: 'ASSUMPTION',
      text: 'Record that Harbor approved a temporary exception to the deletion policy.',
    },
  ],
  procurement: [
    {
      type: 'NEXT_ACTION',
      text: 'Confirm final pilot pricing with Harbor.',
    },
    {
      type: 'NEXT_ACTION',
      text: 'Prepare the refreshed penetration-test report for security review.',
    },
    {
      type: 'DECISION',
      text: 'Reconsider the confirmed CSV integration decision.',
    },
  ],
};

function harborDemoProposals(turn: string, assistantMessageId: string): AskContextProposal[] {
  return (HARBOR_DEMO_PROPOSALS[turn] ?? []).map((proposal) => ({
    ...proposal,
    id: proposalIdFor(assistantMessageId, proposal),
    status: 'OPEN',
    sourceMessageId: assistantMessageId,
    confirmationStatus: 'pending',
  }));
}

function markLiveResponseWithFixtureProposals(response: AskResult): AskResult {
  if (!response.execution) return response;
  return {
    ...response,
    execution: {
      ...response.execution,
      mode: response.execution.mode ?? 'live',
      fixtureId: 'harbor-history-proposals',
      fixtureVersion: 1,
    },
  };
}

interface HarborAskTurn {
  project: Project;
  chat: AskChatSession;
  response: AskResult;
  assistantMessageId: string;
  userHistoryEventId: string;
  proposals: AskContextProposal[];
}

async function runHarborAskTurn(params: {
  userId: string;
  project: Project;
  chat: AskChatSession;
  turn: string;
  message: string;
  recorder?: DeveloperGenerationRecorder;
}): Promise<HarborAskTurn> {
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
    id: userMessageId,
    chatId: params.chat.id,
    userId: params.userId,
    projectId: params.project.id,
    role: 'user',
    text: params.message,
    sources: [],
        createdAt: now,
      });
    },
  );
  const context = await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Ask context processed', category: 'ask', chatId: params.chat.id, messageId: userMessageId, summary: 'Processed the Ask message through the Context Agent.' },
    () => persistAskConversationContext({
    userId: params.userId,
    chatId: params.chat.id,
    messageId: userMessageId,
    text: params.message,
    projectId: params.project.id,
      captureProcessingLog: true,
    }),
  );
  const projectAfterContext = await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Project reloaded', category: 'storage', summary: 'Reloaded project state after Ask context processing.' },
    () => storage.getProject(params.userId, params.project.id),
  );
  if (!projectAfterContext) throw new Error('The Harbor Ask turn lost its project after context ingestion.');

  const liveResponse = await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Partner response completed', category: 'ask', chatId: params.chat.id, messageId: assistantMessageId, summary: 'Completed the Partner Agent response.' },
    () => askGapswise({
    userId: params.userId,
    message: params.message,
    projectId: params.project.id,
    chatId: params.chat.id,
    ...(params.chat.adkSessionId ? { sessionId: params.chat.adkSessionId } : {}),
    excludeMessageId: userMessageId,
    excludeSourceId: context.sourceId,
      openQuestions: context.openQuestions,
    }),
  );
  // The answer and execution details are always from the live Partner Agent.
  // The fixture controls only which proposal cards the historical journey
  // displays, so the demo does not depend on a model spontaneously returning
  // a particular proposal or ordering its proposals predictably.
  const proposals = harborDemoProposals(params.turn, assistantMessageId);
  const response = {
    ...markLiveResponseWithFixtureProposals(liveResponse),
    contextProposals: proposals,
    proposals,
  } satisfies AskResult;
  await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Ask assistant message persisted', category: 'ask', chatId: params.chat.id, messageId: assistantMessageId, summary: 'Persisted the Partner Agent response.' },
    () => storage.saveAskMessage(params.userId, {
    id: assistantMessageId,
    chatId: params.chat.id,
    userId: params.userId,
    projectId: params.project.id,
    role: 'assistant',
    text: response.answer,
    sources: response.sources,
    createdAt: new Date().toISOString(),
    openQuestionIds: response.openQuestionIds ?? [],
    openQuestions: response.openQuestions ?? [],
    ...(response.outcome ? { outcome: response.outcome } : {}),
    ...(response.resolvesQuestionId ? { resolvesQuestionId: response.resolvesQuestionId } : {}),
    ...(response.conclusion ? { conclusion: response.conclusion } : {}),
    contextProposals: proposals,
    proposals,
    ...(response.searchSuggestions ? { searchSuggestions: response.searchSuggestions } : {}),
      ...(response.execution ? { execution: response.execution } : {}),
    }),
  );
  const chat = {
    ...params.chat,
    ...(response.sessionId ? { adkSessionId: response.sessionId } : {}),
    updatedAt: new Date().toISOString(),
  } satisfies AskChatSession;
  await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Ask chat updated', category: 'ask', chatId: chat.id, summary: 'Updated the Ask chat session.' },
    () => storage.saveAskChat(params.userId, chat),
  );
  let projectForTurn = projectAfterContext;
  let userEvent = (projectAfterContext.historyEvents ?? []).find((event) => event.id === context.historyEventId)
    ?? latestEvent(projectAfterContext, 'context_added', (event) => event.sourceId === context.sourceId);
  if (!userEvent) {
    // Meta-level Ask messages can intentionally produce no graph mutation.
    // Keep their conversational transition in the project timeline so the
    // corresponding snapshot still has an exact immutable trigger event.
    userEvent = {
      id: boundedId('history', `${params.project.id}:ask:${params.turn}`),
      projectId: params.project.id,
      createdAt: new Date().toISOString(),
      type: 'context_changed',
      title: `Ask conversation · ${params.turn}`,
      summary: `Recorded the Ask conversation: ${params.message}`,
    };
    projectForTurn = {
      ...projectAfterContext,
      historyEvents: [...(projectAfterContext.historyEvents ?? []), userEvent],
      updated_at: new Date().toISOString(),
    };
    await recordDeveloperGenerationStep(
      params.recorder,
      { name: 'Project saved', category: 'storage', summary: 'Saved the Ask conversation history event.' },
      () => storage.saveProject(params.userId, projectForTurn),
    );
  }
  await snapshotForEvent({
    userId: params.userId,
    project: projectForTurn,
    event: userEvent,
    type: 'ask_response_created',
    askMessageId: assistantMessageId,
    label: `Ask response · ${params.turn}`,
    summary: response.answer.slice(0, 240),
    recorder: params.recorder,
  });
  return {
    project: projectForTurn,
    chat,
    response,
    assistantMessageId,
    userHistoryEventId: userEvent.id,
    proposals,
  };
}

function proposalMatching(
  turn: HarborAskTurn,
  pattern: RegExp,
  description: string,
): AskContextProposal {
  const proposal = turn.proposals.find((candidate) => pattern.test(candidate.text));
  if (!proposal) {
    throw new Error(`The Harbor fixture is missing its ${description} proposal.`);
  }
  return proposal;
}

async function proposalTransitionEvent(
  project: Project,
  action: 'add' | 'dismiss',
  messageId: string,
  proposal: AskContextProposal,
): Promise<ProjectHistoryEvent> {
  const proposalId = proposal.id ?? 'proposal';
  const eventId = boundedId('history', `${project.id}:ask_proposal:${action}:${messageId}:${proposalId}`);
  const existing = project.historyEvents?.find((event) => event.id === eventId);
  if (existing) return existing;

  const createdAt = new Date().toISOString();
  const sourceId = proposalSourceIdFor(messageId, proposalId);
  const source = project.sources.find((candidate) => candidate.id === sourceId);
  return {
    id: eventId,
    projectId: project.id,
    createdAt,
    // These event types are consumed by the Harbor history demo and the
    // snapshot trigger. The shared history type predates proposal events.
    type: action === 'add' ? 'ask_proposal_added' : 'ask_proposal_dismissed',
    title: action === 'add' ? 'Ask suggestion added' : 'Ask suggestion dismissed',
    summary: `${action === 'add' ? 'Added' : 'Dismissed'} Ask suggestion: ${proposal.text}`,
    ...(action === 'add' ? { sourceId } : {}),
    ...(source?.derived_node_ids?.length ? { affectedNodeIds: source.derived_node_ids } : {}),
  } as ProjectHistoryEvent;
}

async function appendProposalTransitionEvent(
  project: Project,
  action: 'add' | 'dismiss',
  messageId: string,
  proposal: AskContextProposal,
): Promise<{ project: Project; event: ProjectHistoryEvent }> {
  const event = await proposalTransitionEvent(project, action, messageId, proposal);
  if (project.historyEvents?.some((candidate) => candidate.id === event.id)) {
    return { project, event };
  }
  const nextProject: Project = {
    ...project,
    historyEvents: [...(project.historyEvents ?? []), event],
    updated_at: event.createdAt,
  };
  return { project: nextProject, event };
}

async function transitionHarborProposal(params: {
  userId: string;
  turn: HarborAskTurn;
  proposal: AskContextProposal;
  action: 'add' | 'dismiss';
  recorder?: DeveloperGenerationRecorder;
}): Promise<Project> {
  const storage = getStorageProvider();
  const messages = await storage.getAskMessages(params.userId);
  const message = messages.find((candidate) => candidate.id === params.turn.assistantMessageId);
  if (!message) throw new Error(`The Ask message for ${params.action} proposal transition was not found.`);
  const proposalId = params.proposal.id;
  if (!proposalId) throw new Error('A Harbor proposal is missing its stable ID.');
  const nextProposal: AskContextProposal = {
    ...params.proposal,
    confirmationStatus: params.action === 'add' ? 'added' : 'dismissed',
  };
  const nextMessage = {
    ...message,
    contextProposals: (message.contextProposals ?? message.proposals ?? []).map((candidate) =>
      candidate.id === proposalId ? nextProposal : candidate
    ),
    proposals: (message.contextProposals ?? message.proposals ?? []).map((candidate) =>
      candidate.id === proposalId ? nextProposal : candidate
    ),
  } satisfies AskChatMessage;
  await recordDeveloperGenerationStep(
    params.recorder,
    {
      name: params.action === 'add' ? 'Proposal added' : 'Proposal dismissed',
      category: 'proposal',
      chatId: message.chatId,
      messageId: message.id,
      proposalId,
      summary: `${params.action === 'add' ? 'Added' : 'Dismissed'} the Ask proposal.`,
    },
    () => storage.saveAskMessage(params.userId, nextMessage),
  );

  let project = await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Project reloaded', category: 'storage', summary: 'Reloaded project state before applying the proposal transition.' },
    () => storage.getProject(params.userId, params.turn.project.id),
  ) ?? params.turn.project;
  if (params.action === 'add') {
    try {
      project = await recordDeveloperGenerationStep(
        params.recorder,
        {
          name: 'Proposal source processed',
          category: 'proposal',
          chatId: message.chatId,
          messageId: message.id,
          proposalId,
          sourceId: proposalSourceIdFor(message.id, proposalId),
          summary: 'Persisted and processed the proposal as project context.',
        },
        () => persistAskProposal({
          userId: params.userId,
          projectId: project.id,
          assistantMessageId: message.id,
          proposal: nextProposal,
        }),
      );
    } catch (error) {
      const pending: AskContextProposal = { ...nextProposal, confirmationStatus: 'pending' };
      await storage.saveAskMessage(params.userId, {
        ...nextMessage,
        contextProposals: (message.contextProposals ?? message.proposals ?? []).map((candidate) =>
          candidate.id === proposalId ? pending : candidate
        ),
        proposals: (message.contextProposals ?? message.proposals ?? []).map((candidate) =>
          candidate.id === proposalId ? pending : candidate
        ),
      });
      throw error;
    }
  }
  const proposalSourceId = proposalSourceIdFor(message.id, proposalId);
  const proposalContextEvent = params.action === 'add'
    ? latestEvent(project, 'context_added', (candidate) => candidate.sourceId === proposalSourceId)
    : undefined;
  if (proposalContextEvent) {
    // The normal proposal persistence path creates the canonical context
    // mutation event. Keep that event's own historical moment, then add a
    // separate event for the user's proposal action below.
    await snapshotForEvent({
      userId: params.userId,
      project,
      event: proposalContextEvent,
      type: 'context_processed',
      sourceId: proposalSourceId,
      label: 'Ask proposal context processed',
      summary: proposalContextEvent.summary,
      recorder: params.recorder,
    });
  }
  const transition = await appendProposalTransitionEvent(project, params.action, message.id, nextProposal);
  project = transition.project;
  await recordDeveloperGenerationStep(
    params.recorder,
    { name: 'Project saved', category: 'storage', summary: 'Saved the proposal transition.' },
    () => storage.saveProject(params.userId, project),
  );
  await snapshotForEvent({
    userId: params.userId,
    project,
    event: transition.event,
    type: params.action === 'add' ? 'ask_proposal_added' : 'ask_proposal_dismissed',
    askMessageId: message.id,
    proposalId,
    label: params.action === 'add' ? 'Ask proposal added' : 'Ask proposal dismissed',
    summary: nextProposal.text,
    recorder: params.recorder,
  });
  return project;
}

function missingSnapshotEvents(project: Project, snapshots: Awaited<ReturnType<ReturnType<typeof getStorageProvider>['listProjectSnapshots']>>): HarborHistoryDemoResult['missingSnapshotEvents'] {
  return (project.historyEvents ?? [])
    .filter((event) => {
      if (snapshots.some((snapshot) => snapshot.trigger.historyEventId === event.id)) {
        return false;
      }
      if (event.type === 'project_started') {
        return !snapshots.some((snapshot) => snapshot.trigger.type === 'project_created' && !snapshot.trigger.historyEventId);
      }
      return !snapshots.some((snapshot) => snapshot.trigger.historyEventId === event.id);
    })
    .map((event) => ({ id: event.id, title: event.title, type: event.type }));
}

function finalRehearsalQuestion(project: Project): ClarityNode | undefined {
  return project.nodes.find((node) =>
    ['UNKNOWN', 'ASSUMPTION', 'RISK', 'NEXT_ACTION'].includes(node.type)
      && node.status === 'OPEN'
      && /production.*access|access.*rehearsal|rehearsal/i.test(node.text)
  );
}

function snapshotHasTrigger(snapshot: ProjectSnapshot, type: ProjectSnapshotTrigger): boolean {
  return snapshot.trigger.type === type;
}

async function askProposalTransition(
  userId: string,
  turn: HarborAskTurn,
  pattern: RegExp,
  action: 'add' | 'dismiss',
  description: string,
  recorder?: DeveloperGenerationRecorder,
): Promise<Project> {
  const proposal = proposalMatching(turn, pattern, description);
  return transitionHarborProposal({ userId, turn, proposal, action, recorder });
}

export async function createHarborHistoryDemoForUser(params: {
  userId: string;
  fresh?: boolean;
}): Promise<HarborHistoryDemoResult> {
  const storage = getStorageProvider();
  const createdAt = new Date().toISOString();
  let project = createProjectFromInput(projectInput(HARBOR_HISTORY_DEMO_TITLE), createdAt);
  const created = true;
  const pdfs: HarborHistoryDemoResult['pdfs'] = [];
  const recorder = await startDeveloperGenerationRun({
    userId: params.userId,
    projectId: project.id,
    generator: 'Harbor history demo',
  });

  try {
    await recorder.step(
      { name: 'Generation started', category: 'project', summary: 'Started a fresh Harbor history generation.' },
      () => project,
    );
    await recorder.step(
      { name: 'Project created in memory', category: 'project', summary: 'Created the Harbor project before persistence.' },
      () => project,
    );

    if (created) {
      await recorder.step(
        { name: 'Initial project saved', category: 'storage', summary: 'Saved the new Harbor project.' },
        () => storage.saveProject(params.userId, project),
      );
      const event = latestEvent(project, 'project_started');
      if (!event) throw new Error('The Harbor history demo project has no project-started event.');
      await snapshotForEvent({
        userId: params.userId,
        project,
        event,
        type: 'project_created',
        label: 'Project created',
        summary: 'The Harbor pilot history demo project was created with its launch goal.',
        recorder,
      });
    }

  project = await processDocument(params.userId, project, HARBOR_HISTORY_DOCUMENTS[0], recorder);
  const planningChat: AskChatSession = {
    id: boundedId('chat', `${project.id}:planning`),
    userId: params.userId,
    scopeType: 'project',
    projectId: project.id,
    title: 'Planning the Harbor pilot',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const firstAsk = await runHarborAskTurn({
    userId: params.userId,
    project,
    chat: planningChat,
    turn: 'planning',
    message: 'Based on what we know so far, what should I clarify before committing to the November launch?',
    recorder,
  });
  project = await askProposalTransition(
    params.userId,
    firstAsk,
    /security|procurement|purchase order|approval/i,
    'add',
    'security and procurement',
    recorder,
  );
  project = await askProposalTransition(
    params.userId,
    { ...firstAsk, project },
    /500|1[,.]?000|expand/i,
    'dismiss',
    'premature pilot expansion',
    recorder,
  );

  project = await processDocument(params.userId, project, HARBOR_HISTORY_DOCUMENTS[1], recorder);
  const secondAsk = await runHarborAskTurn({
    userId: params.userId,
    project,
    chat: firstAsk.chat,
    turn: 'security-impact',
    message: 'If engineering cannot meet the 30-day deletion requirement, what parts of the project would be affected?',
    recorder,
  });
  project = await askProposalTransition(
    params.userId,
    secondAsk,
    /30.?day|deletion|engineering/i,
    'add',
    'deletion-support action',
    recorder,
  );
  project = await askProposalTransition(
    params.userId,
    { ...secondAsk, project },
    /exception|temporary approval|approved.*exception/i,
    'dismiss',
    'unsupported deletion exception',
    recorder,
  );

  project = await processDocument(params.userId, project, HARBOR_HISTORY_DOCUMENTS[2], recorder);
  project = await resolveTechnicalDecision(params.userId, project, recorder);
  const procurementAsk = await runHarborAskTurn({
    userId: params.userId,
    project,
    chat: secondAsk.chat,
    turn: 'procurement',
    message: 'What do I still need before Harbor procurement can issue the purchase order?',
    recorder,
  });
  project = await askProposalTransition(
    params.userId,
    procurementAsk,
    /price|pricing|commercial/i,
    'add',
    'final pricing',
    recorder,
  );
  project = await askProposalTransition(
    params.userId,
    { ...procurementAsk, project },
    /penetration|security package|security report/i,
    'add',
    'refreshed penetration test',
    recorder,
  );
  project = await askProposalTransition(
    params.userId,
    { ...procurementAsk, project },
    /CSV|integration/i,
    'dismiss',
    'redundant integration reconsideration',
    recorder,
  );

  project = await processDocument(params.userId, project, HARBOR_HISTORY_DOCUMENTS[3], recorder);
  project = await resolveDeletionQuestion(params.userId, project, recorder);
  project = await resolvePricingDecision(params.userId, project, recorder);
  project = await processDocument(params.userId, project, HARBOR_HISTORY_DOCUMENTS[4], recorder);

  HARBOR_HISTORY_DOCUMENTS.forEach((document) => {
    const source = project.sources.find((candidate) => candidate.id === sourceIdFor(project.id, document));
    pdfs.push({
      filename: document.filename,
      sizeBytes: source?.size_bytes ?? pdfBytes(document).length,
      stored: Boolean(source?.storage_url),
    });
  });

  const snapshots = await storage.listProjectSnapshots(params.userId, project.id);
  const snapshotRecords = (await Promise.all(
    snapshots.map((summary) => storage.getProjectSnapshot(params.userId, summary.id)),
  )).filter((snapshot): snapshot is ProjectSnapshot => Boolean(snapshot));
  const messages = (await storage.getAskMessages(params.userId)).filter((message) => message.projectId === project.id);
  const chats = (await storage.getAskChats(params.userId)).filter((chat) => chat.projectId === project.id);
  const proposals = messages.flatMap((message) => normalizeAskContextProposals(message.contextProposals ?? message.proposals));
  const userMessages = messages.filter((message) => message.role === 'user');
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  const addedProposalCount = proposals.filter((proposal) => proposal.confirmationStatus === 'added').length;
  const dismissedProposalCount = proposals.filter((proposal) => proposal.confirmationStatus === 'dismissed').length;
  const pendingProposalCount = proposals.filter((proposal) => !proposal.confirmationStatus || proposal.confirmationStatus === 'pending' || proposal.confirmationStatus === 'proposed').length;
  const askResponseSnapshotCount = snapshotRecords.filter((snapshot) => snapshotHasTrigger(snapshot, 'ask_response_created')).length;
  const proposalAddedSnapshotCount = snapshotRecords.filter((snapshot) => snapshotHasTrigger(snapshot, 'ask_proposal_added')).length;
  const proposalDismissedSnapshotCount = snapshotRecords.filter((snapshot) => snapshotHasTrigger(snapshot, 'ask_proposal_dismissed')).length;
  const snapshotEventIds = snapshotRecords.map((snapshot) => snapshot.trigger.historyEventId).filter((id): id is string => Boolean(id));
  const uniqueSnapshotEventCount = new Set(snapshotEventIds).size;
  const askResponseEventIds = new Set(
    snapshotRecords
      .filter((snapshot) => snapshotHasTrigger(snapshot, 'ask_response_created'))
      .map((snapshot) => snapshot.trigger.historyEventId),
  );
  const proposalEvents = (project.historyEvents ?? []).filter((event) =>
    event.type === 'ask_proposal_added' || event.type === 'ask_proposal_dismissed'
  );
  const proposalSnapshotEventCounts = new Map<string, number>();
  snapshotRecords.forEach((snapshot) => {
    if (snapshot.trigger.type !== 'ask_proposal_added' && snapshot.trigger.type !== 'ask_proposal_dismissed') return;
    const eventId = snapshot.trigger.historyEventId;
    if (eventId) proposalSnapshotEventCounts.set(eventId, (proposalSnapshotEventCounts.get(eventId) ?? 0) + 1);
    if (eventId && askResponseEventIds.has(eventId)) {
      throw new Error('A Harbor proposal-transition snapshot reused an Ask-response history event.');
    }
  });
  if (userMessages.length !== 3 || assistantMessages.length !== 3) {
    throw new Error(`Harbor history demo expected exactly three user and assistant Ask messages, got ${userMessages.length} and ${assistantMessages.length}.`);
  }
  if (addedProposalCount !== 4 || dismissedProposalCount !== 3 || pendingProposalCount !== 0) {
    throw new Error(`Harbor history demo expected 4 added, 3 dismissed, and 0 pending proposals, got ${addedProposalCount}, ${dismissedProposalCount}, and ${pendingProposalCount}.`);
  }
  if (askResponseSnapshotCount !== 3 || proposalAddedSnapshotCount !== 4 || proposalDismissedSnapshotCount !== 3) {
    throw new Error(`Harbor history demo expected 3 Ask-response, 4 proposal-added, and 3 proposal-dismissed snapshots, got ${askResponseSnapshotCount}, ${proposalAddedSnapshotCount}, and ${proposalDismissedSnapshotCount}.`);
  }
  if (proposalEvents.length !== 7 || proposalEvents.some((event) => proposalSnapshotEventCounts.get(event.id) !== 1)) {
    const missingProposalSnapshots = proposalEvents
      .filter((event) => proposalSnapshotEventCounts.get(event.id) !== 1)
      .map((event) => `${event.id}:${proposalSnapshotEventCounts.get(event.id) ?? 0}`)
      .join(', ');
    throw new Error(`Every Harbor proposal transition must have exactly one matching snapshot. Missing: ${missingProposalSnapshots}`);
  }
  if (snapshotRecords.length !== snapshots.length || uniqueSnapshotEventCount !== snapshotRecords.length) {
    throw new Error('Harbor history demo snapshot event references must be unique and fully materialized.');
  }
  const missingTransitionTypes = (['ask_response_created', 'ask_proposal_added', 'ask_proposal_dismissed'] as const)
    .filter((type) => !snapshotRecords.some((snapshot) => snapshotHasTrigger(snapshot, type)));
  if (missingTransitionTypes.length > 0) {
    throw new Error(`Harbor history demo is missing snapshot transitions: ${missingTransitionTypes.join(', ')}.`);
  }
  if (missingSnapshotEvents(project, snapshots).length > 0) {
    const missing = missingSnapshotEvents(project, snapshots).map((event) => `${event.id}:${event.type}`).join(', ');
    throw new Error(`Harbor history demo has history events without exact snapshots: ${missing}`);
  }
  if (snapshots.some((snapshot) => !snapshot.trigger.historyEventId)) {
    throw new Error('Harbor history demo created a snapshot without an exact history event reference.');
  }
  if (snapshotRecords.some((snapshot) => !snapshot.assessments.focus || !snapshot.assessments.overview || !snapshot.assessments.today)) {
    throw new Error('Harbor history demo created a snapshot without Focus, Overview, or Today assessment state.');
  }
  if (!finalRehearsalQuestion(project)) {
    throw new Error('Harbor history demo final state is missing its open production access rehearsal question.');
  }
  const downloadablePdfCount = HARBOR_HISTORY_DOCUMENTS.filter((document) =>
    project.sources.some((source) => source.id === sourceIdFor(project.id, document) && source.storage_url)
  ).length;
  if (downloadablePdfCount !== HARBOR_HISTORY_DOCUMENTS.length) {
    throw new Error('Harbor history demo did not store every required PDF as a downloadable asset.');
  }
  const finalOpenQuestions = project.nodes
    .filter((node) => node.status === 'OPEN' && ['UNKNOWN', 'ASSUMPTION', 'DECISION', 'RISK'].includes(node.type))
    .map((node) => ({ id: node.id, type: node.type, text: node.text }));
  const graphHealth = buildGraphHealthReport(project);
  const relationshipCountsByType = project.edges.reduce<Partial<Record<EdgeType, number>>>((counts, edge) => {
    counts[edge.type] = (counts[edge.type] ?? 0) + 1;
    return counts;
  }, {});
  const hasRelationshipCompletionTrace = (source: Project['sources'][number]): boolean =>
    Boolean(source.processing_log?.stages.some((stage) => stage.name === 'Relationship completion'));
  const pdfSourcesWithCompletionTrace = project.sources.filter((source) =>
    source.type === 'pdf' && hasRelationshipCompletionTrace(source)
  ).length;
  const askProposalSourcesWithCompletionTrace = project.sources.filter((source) =>
    source.id.startsWith('ask_proposal_') && hasRelationshipCompletionTrace(source)
  ).length;
  const projects = await storage.listProjects(params.userId);
  const scope: AppScope = { type: 'project', projectId: project.id };
  await recorder.step(
    { name: 'Final project validation', category: 'validation', summary: 'Validated the completed Harbor history project and its snapshots.' },
    () => undefined,
  );
  await recorder.step(
    { name: 'Active project/scope selected', category: 'project', summary: 'Selected the generated Harbor project as the active scope.' },
    () => storage.setAppScope(params.userId, scope),
  );
  const result: HarborHistoryDemoResult = {
    generationRunId: recorder.run.id,
    project,
    projects,
    activeProjectId: project.id,
    scope,
    created,
    fresh: Boolean(params.fresh),
    snapshotCount: snapshots.length,
    historyEventCount: project.historyEvents?.length ?? 0,
    finalNodeCount: project.nodes.length,
    finalEdgeCount: project.edges.length,
    missingSnapshotEvents: missingSnapshotEvents(project, snapshots),
    pdfs,
    projectTitle: project.title,
    chatCount: chats.length,
    messageCount: messages.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    addedProposalCount,
    dismissedProposalCount,
    pendingProposalCount,
    proposalCounts: {
      added: addedProposalCount,
      dismissed: dismissedProposalCount,
      pending: pendingProposalCount,
    },
    uniqueSnapshotEventCount,
    askResponseSnapshotCount,
    proposalAddedSnapshotCount,
    proposalDismissedSnapshotCount,
    snapshotsWithFocus: snapshotRecords.filter((snapshot) => Boolean(snapshot.assessments.focus)).length,
    snapshotsWithOverview: snapshotRecords.filter((snapshot) => Boolean(snapshot.assessments.overview)).length,
    snapshotsWithToday: snapshotRecords.filter((snapshot) => Boolean(snapshot.assessments.today)).length,
    downloadablePdfCount,
    finalOpenQuestions,
    graphHealth,
    relationshipCountsByType,
    pdfSourcesWithCompletionTrace,
    askProposalSourcesWithCompletionTrace,
  };
  await recorder.step(
    { name: 'Generation completed', category: 'validation', summary: 'Completed the Harbor history generation.' },
    () => undefined,
  );
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
