import type { FeedbackEvent } from '@/types/feedback';
import type { ClarityNode, Project } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';
import { resolveGap } from '@/lib/tools/graphTools';

export const CAREER_CONFLICT_DEMO_ID = 'career_conflict_demo';
export const CAREER_CONFLICT_QUESTION_ID = 'unknown_career_role_acceptability';
export const CAREER_CONFLICT_JOB_SOURCE_ID = 'src_career_frontend_job';
export const CAREER_CONFLICT_RECRUITER_SOURCE_ID = 'src_career_recruiter_call';
export const CAREER_CONFLICT_MEMORY_PREFIX = 'career_demo_';

export const CAREER_CONFLICT_CREATED_AT = '2026-08-16T09:00:00.000Z';

export interface CareerConflictDocument {
  filename: string;
  content: string;
  type: 'pdf';
}

export interface CareerConflictDemoState {
  project: Project;
  memories: DurableMemory[];
  feedbackEvents: FeedbackEvent[];
}

export type CareerRoleDisposition = 'acceptable' | 'not_acceptable' | 'unclear';

export const CAREER_CONFLICT_JOB_DOCUMENT: CareerConflictDocument = {
  filename: 'frontend-role-job-description.pdf',
  type: 'pdf',
  content: [
    'Product Engineer role.',
    'The role is primarily frontend, with most work focused on React, UI delivery, and design-system implementation.',
    'The position offers strong compensation and a clear path toward financial stability.',
  ].join(' '),
};

function memory(params: {
  id: string;
  category: DurableMemory['category'];
  text: string;
  source?: DurableMemory['source'];
  now?: string;
}): DurableMemory {
  const timestamp = params.now ?? CAREER_CONFLICT_CREATED_AT;
  return {
    id: params.id,
    category: params.category,
    text: params.text,
    source: params.source ?? 'seed',
    source_refs: [],
    confidence: params.source === 'user_confirmed' ? 1 : 0.95,
    created_at: timestamp,
    updated_at: timestamp,
    last_confirmed_at: timestamp,
    why_remembered: params.source === 'user_confirmed'
      ? 'Confirmed during the career conflict demo.'
      : 'Seeded by the deterministic career conflict demo.',
  };
}

export function createCareerConflictDemoMemories(): DurableMemory[] {
  return [
    memory({
      id: `${CAREER_CONFLICT_MEMORY_PREFIX}goal_financial_stability`,
      category: 'current_priorities',
      text: 'Financial stability is my top priority.',
    }),
    memory({
      id: `${CAREER_CONFLICT_MEMORY_PREFIX}preference_avoid_frontend`,
      category: 'career',
      text: 'I prefer to avoid frontend-heavy roles.',
    }),
  ];
}

function node(params: Omit<ClarityNode, 'created_by' | 'created_at' | 'updated_at'>): ClarityNode {
  return {
    ...params,
    created_by: 'agent',
    created_at: CAREER_CONFLICT_CREATED_AT,
    updated_at: CAREER_CONFLICT_CREATED_AT,
  };
}

export function readCareerConflictJobDocument(): CareerConflictDocument {
  return { ...CAREER_CONFLICT_JOB_DOCUMENT };
}

export function detectCareerConflict(
  document: CareerConflictDocument,
  memories: DurableMemory[],
): boolean {
  const documentMentionsFrontend = /\bfront[- ]end\b|\bfrontend\b/i.test(document.content);
  const avoidsFrontend = memories.some((item) =>
    !item.forgotten_at &&
    /\bavoid|do not|don't|prefer not to\b/i.test(item.text) &&
    /\bfront[- ]end\b|\bfrontend\b/i.test(item.text)
  );
  return documentMentionsFrontend && avoidsFrontend;
}

export function createCareerConflictDemoProject(): Project {
  const jobDocument = readCareerConflictJobDocument();
  const project: Project = {
    id: CAREER_CONFLICT_DEMO_ID,
    title: 'Career Stability — Recruiter Decision',
    goal: 'Build financial stability through sustainable work.',
    status: 'active',
    one_sentence_context: 'Decide whether a well-paid frontend-heavy role fits the user’s longer-term work preferences.',
    clarity_score: 46,
    created_at: CAREER_CONFLICT_CREATED_AT,
    updated_at: CAREER_CONFLICT_CREATED_AT,
    sources: [
      {
        id: CAREER_CONFLICT_JOB_SOURCE_ID,
        filename: jobDocument.filename,
        type: jobDocument.type,
        content: jobDocument.content,
        extracted_at: CAREER_CONFLICT_CREATED_AT,
        derived_node_ids: ['career_role_frontend'],
        processing_status: 'completed',
        mime_type: 'application/pdf',
        origin: 'user',
        extraction_summary: 'Read job document: the role is primarily frontend and offers strong compensation.',
      },
      {
        id: CAREER_CONFLICT_RECRUITER_SOURCE_ID,
        filename: 'recruiter-call-invitation.txt',
        type: 'note',
        content: 'Upcoming recruiter call to discuss the primarily frontend Product Engineer role and compensation.',
        extracted_at: CAREER_CONFLICT_CREATED_AT,
        derived_node_ids: ['career_recruiter_call'],
        processing_status: 'completed',
        origin: 'user',
        extraction_summary: 'Upcoming recruiter call for the role described in the job document.',
      },
    ],
    nodes: [
      node({
        id: 'career_financial_goal',
        type: 'GOAL',
        text: 'Build financial stability through sustainable work',
        status: 'OPEN',
        confidence: 1,
        impact: 1,
        source_refs: [],
      }),
      node({
        id: 'career_role_frontend',
        type: 'KNOWN',
        text: 'The recruiter role is primarily frontend.',
        status: 'RESOLVED',
        confidence: 0.96,
        impact: 0.88,
        source_refs: [CAREER_CONFLICT_JOB_SOURCE_ID],
      }),
      node({
        id: 'career_recruiter_call',
        type: 'NEXT_ACTION',
        text: 'Attend the upcoming recruiter call for the Product Engineer role',
        status: 'OPEN',
        confidence: 0.95,
        impact: 0.84,
        priority: 0.82,
        source_refs: [CAREER_CONFLICT_RECRUITER_SOURCE_ID],
        why_it_matters: ['The call is the next opportunity to clarify role fit and compensation.'],
      }),
      node({
        id: CAREER_CONFLICT_QUESTION_ID,
        type: 'UNKNOWN',
        text: 'Does this primarily frontend role remain acceptable given your preference to avoid frontend-heavy roles?',
        status: 'OPEN',
        confidence: 0.15,
        impact: 0.94,
        priority: 0.96,
        source_refs: [CAREER_CONFLICT_JOB_SOURCE_ID, CAREER_CONFLICT_RECRUITER_SOURCE_ID],
        why_it_matters: [
          'This determines whether to prepare for or decline the recruiter call.',
          'It tests how financial stability should be balanced against the user’s role preference.',
        ],
      }),
    ],
    edges: [
      { id: 'career_role_informs_question', source: 'career_role_frontend', target: CAREER_CONFLICT_QUESTION_ID, type: 'informs' },
      { id: 'career_question_blocks_call', source: CAREER_CONFLICT_QUESTION_ID, target: 'career_recruiter_call', type: 'blocks' },
      { id: 'career_goal_informs_call', source: 'career_financial_goal', target: 'career_recruiter_call', type: 'informs' },
    ],
    history: [],
    active_question: null,
  };

  return project;
}

export function createCareerConflictDemoState(): CareerConflictDemoState {
  const memories = createCareerConflictDemoMemories();
  const project = createCareerConflictDemoProject();
  if (!detectCareerConflict(readCareerConflictJobDocument(), memories)) {
    throw new Error('Career conflict demo seed must contain a detectable preference conflict.');
  }
  return { project, memories, feedbackEvents: [] };
}

export function careerRoleDisposition(answer: string): CareerRoleDisposition {
  const negative = /\b(no|not|decline|reject|avoid|would not|wouldn't|won't|does not|doesn't)\b/i.test(answer);
  if (negative) return 'not_acceptable';
  if (/\b(yes|acceptable|accept|open to|willing|fine|okay|keep|continue)\b/i.test(answer)) return 'acceptable';
  return 'unclear';
}

export function updateCareerConflictMemories(
  memories: DurableMemory[],
  answer: string,
  now = new Date().toISOString(),
): DurableMemory[] {
  const disposition = careerRoleDisposition(answer);
  if (disposition === 'unclear') return memories;

  const retained = memories.filter((item) => !item.id.startsWith(`${CAREER_CONFLICT_MEMORY_PREFIX}answer_`));
  const answerMemory = disposition === 'acceptable'
    ? memory({
        id: `${CAREER_CONFLICT_MEMORY_PREFIX}answer_acceptable`,
        category: 'career',
        text: 'I am willing to consider this primarily frontend role because it supports financial stability.',
        source: 'user_confirmed',
        now,
      })
    : memory({
        id: `${CAREER_CONFLICT_MEMORY_PREFIX}answer_not_acceptable`,
        category: 'career',
        text: 'This primarily frontend role is not acceptable to me.',
        source: 'user_confirmed',
        now,
      });
  return [answerMemory, ...retained];
}

export function answerCareerConflictDemo(
  state: CareerConflictDemoState,
  answer: string,
  now = new Date('2026-08-16T10:00:00.000Z'),
): CareerConflictDemoState {
  const project = resolveGap(state.project, CAREER_CONFLICT_QUESTION_ID, answer);
  const memories = updateCareerConflictMemories(state.memories, answer, now.toISOString());
  const disposition = careerRoleDisposition(answer);
  const feedback: FeedbackEvent = {
    id: `${CAREER_CONFLICT_MEMORY_PREFIX}feedback_role_acceptability`,
    userId: 'demo-user',
    targetType: 'question',
    targetId: CAREER_CONFLICT_QUESTION_ID,
    rating: 'useful',
    explanation: answer,
    created_at: now.toISOString(),
    metadata: {
      demo: 'career-conflict',
      role_acceptable: disposition === 'acceptable',
    },
  };

  return {
    project,
    memories,
    feedbackEvents: [feedback, ...state.feedbackEvents.filter((event) => event.id !== feedback.id)],
  };
}
