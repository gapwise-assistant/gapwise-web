import type { FeedbackEvent } from '@/types/feedback';
import type { ClarityNode, Project } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';
import { resolveGap } from '@/lib/tools/graphTools';
import { calculateClarityScore, selectTopGap } from '@/lib/prioritization';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';

export const CAREER_CONFLICT_DEMO_ID = 'career_conflict_demo';
export const CAREER_CONFLICT_QUESTION_ID = 'unknown_career_role_acceptability';
export const CAREER_CONFLICT_JOB_SOURCE_ID = 'src_career_frontend_job';
export const CAREER_CONFLICT_RECRUITER_SOURCE_ID = 'src_career_recruiter_call';
export const CAREER_CONFLICT_PREP_SOURCE_ID = 'src_career_coach_prep';
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
    'Senior Product Engineer opportunity at Northstar Labs.',
    'The role is primarily frontend: approximately 70–80% of the first year is expected to focus on React, TypeScript, UI delivery, accessibility, client performance, and design-system implementation.',
    'The remaining work is API integration and product analytics; the document does not promise backend service ownership.',
    'The position offers a $155,000–$175,000 base salary, a target bonus, equity, day-one health coverage, and a hybrid schedule.',
    'The first 90-day objective is to lead the customer-dashboard redesign before the October launch.',
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
    memory({
      id: `${CAREER_CONFLICT_MEMORY_PREFIX}goal_backend_ai_growth`,
      category: 'career',
      text: 'I want meaningful backend or applied AI ownership in my next role.',
    }),
    memory({
      id: `${CAREER_CONFLICT_MEMORY_PREFIX}priority_income_timeline`,
      category: 'current_priorities',
      text: 'I want stable income within the next ten weeks.',
    }),
    memory({
      id: `${CAREER_CONFLICT_MEMORY_PREFIX}preference_hybrid`,
      category: 'career',
      text: 'I prefer remote work or no more than two office days per week.',
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
    title: 'Career Transition — Northstar Product Engineer',
    goal: 'Secure financial stability without abandoning a sustainable backend and applied AI career path.',
    status: 'active',
    deadline: '2026-08-20',
    one_sentence_context: 'Evaluate a well-paid, frontend-heavy opportunity before a near-term recruiter call using compensation, work-mix, growth, and flexibility evidence.',
    clarity_score: 0,
    created_at: CAREER_CONFLICT_CREATED_AT,
    updated_at: CAREER_CONFLICT_CREATED_AT,
    sources: [
      {
        id: CAREER_CONFLICT_JOB_SOURCE_ID,
        filename: jobDocument.filename,
        type: jobDocument.type,
        content: jobDocument.content,
        extracted_at: CAREER_CONFLICT_CREATED_AT,
        derived_node_ids: ['career_role_frontend', 'career_first_90_days', 'career_hybrid_schedule'],
        processing_status: 'completed',
        mime_type: 'application/pdf',
        origin: 'user',
        extraction_summary: 'The role is 70–80% frontend, pays $155k–$175k base, uses a hybrid schedule, and starts with a dashboard redesign.',
      },
      {
        id: CAREER_CONFLICT_RECRUITER_SOURCE_ID,
        filename: 'recruiter-call-invitation.txt',
        type: 'note',
        content: 'Recruiter Maya Chen confirmed a 30-minute call within 24 hours to discuss the primarily frontend Product Engineer opportunity, compensation range, team structure, interview timing, and candidate questions.',
        extracted_at: CAREER_CONFLICT_CREATED_AT,
        derived_node_ids: ['career_recruiter_call'],
        processing_status: 'completed',
        origin: 'user',
        extraction_summary: 'A recruiter call is due within 24 hours and is the next chance to clarify fit.',
      },
      {
        id: 'src_career_priorities',
        filename: 'career-priorities-and-dealbreakers.md',
        type: 'note',
        content: 'Priority order: restore stable income, retain backend or applied AI ownership, avoid a frontend-dominant workload, keep commute to two days per week or less, and preserve time for deep technical work. A frontend-heavy position is not automatically rejected, but it needs a credible transition path.',
        extracted_at: CAREER_CONFLICT_CREATED_AT,
        derived_node_ids: ['career_financial_goal', 'career_growth_goal', 'career_preference_frontend', 'career_preference_hybrid'],
        processing_status: 'completed',
        origin: 'user',
        extraction_summary: 'Financial stability leads, but sustainable technical direction and flexibility remain important.',
      },
      {
        id: 'src_career_finance_snapshot',
        filename: 'personal-runway-snapshot.txt',
        type: 'text',
        content: 'Current savings cover approximately five months of fixed expenses. Contract income ends in six weeks. The target is to secure stable employment within ten weeks without accepting a position likely to trigger another search within a year.',
        extracted_at: CAREER_CONFLICT_CREATED_AT,
        derived_node_ids: ['career_cash_runway', 'career_income_timeline', 'career_risk_financial_pressure'],
        processing_status: 'completed',
        origin: 'user',
        extraction_summary: 'Five months of runway creates urgency, but a short-lived mismatch would undermine stability.',
      },
      {
        id: 'src_career_compensation',
        filename: 'northstar-compensation-summary.pdf',
        type: 'pdf',
        content: 'Published range: $155,000–$175,000 base salary plus a 10% target bonus. Equity is described as meaningful but no grant size, strike price, vesting start, refresh policy, or exercise window is listed. Medical coverage begins on day one; the retirement match begins after 90 days.',
        extracted_at: CAREER_CONFLICT_CREATED_AT,
        derived_node_ids: ['career_salary_range', 'career_benefits_start', 'unknown_career_total_compensation'],
        processing_status: 'completed',
        mime_type: 'application/pdf',
        origin: 'user',
        extraction_summary: 'Cash compensation is attractive, while equity value remains unknown.',
      },
      {
        id: 'src_career_company_research',
        filename: 'northstar-company-research.md',
        type: 'text',
        content: 'Northstar Labs is a Series C workflow company with roughly 45 engineers. Public engineering posts emphasize the design system and dashboard migration. An AI-assisted workflow initiative appears on the roadmap, but no dedicated applied AI team or transfer process has been announced.',
        extracted_at: CAREER_CONFLICT_CREATED_AT,
        derived_node_ids: ['career_company_stage', 'career_risk_ai_path', 'assumption_career_backend_path'],
        processing_status: 'completed',
        origin: 'user',
        extraction_summary: 'The company is growing, but the hoped-for backend or AI path is not yet staffed or documented.',
      },
      {
        id: 'src_career_team_notes',
        filename: 'recruiter-thread-team-notes.txt',
        type: 'text',
        content: 'The immediate product team has five product engineers, one shared platform engineer, a designer, and a product manager. The hiring manager values fast UI shipping. Ownership boundaries, on-call expectations, and the actual weekly frontend percentage were not answered in the email thread.',
        extracted_at: CAREER_CONFLICT_CREATED_AT,
        derived_node_ids: ['career_team_shape', 'unknown_career_frontend_split', 'unknown_career_flexibility'],
        processing_status: 'completed',
        origin: 'user',
        extraction_summary: 'The team is product-heavy and leaves work mix, ownership, and on-call expectations unresolved.',
      },
      {
        id: 'src_career_interview_process',
        filename: 'northstar-interview-outline.txt',
        type: 'text',
        content: 'Expected stages are recruiter screen, hiring-manager conversation, technical exercise, product collaboration interview, and final leadership conversation. Dates, total turnaround time, evaluation criteria, and first-90-day success measures are not yet confirmed.',
        extracted_at: CAREER_CONFLICT_CREATED_AT,
        derived_node_ids: ['unknown_career_interview_timeline', 'unknown_career_success_metrics'],
        processing_status: 'completed',
        origin: 'user',
        extraction_summary: 'The interview stages are known, but timing and success criteria are not.',
      },
      {
        id: CAREER_CONFLICT_PREP_SOURCE_ID,
        filename: 'career-coach-prep-meeting.ics',
        type: 'note',
        content: 'Career decision prep meeting with Alex is scheduled soon. Bring the job document, weighted scorecard, role-fit conflict, compensation questions, and a list of recruiter questions. The meeting should produce a clear call strategy.',
        extracted_at: CAREER_CONFLICT_CREATED_AT,
        derived_node_ids: ['career_coach_prep', 'career_prepare_scorecard'],
        processing_status: 'completed',
        origin: 'user',
        extraction_summary: 'A near-term prep meeting should turn the open evidence gaps into a focused recruiter-call plan.',
      },
      {
        id: 'src_career_decision_log',
        filename: 'opportunity-scorecard-v1.md',
        type: 'note',
        content: 'Decision log: take the recruiter call as due diligence instead of rejecting immediately. Score the opportunity on financial stability 40%, work mix 30%, technical growth 20%, and flexibility 10%. Do not continue to the interview loop until the central role-fit conflict is answered.',
        extracted_at: CAREER_CONFLICT_CREATED_AT,
        derived_node_ids: ['career_decision_take_call', 'career_decision_scorecard', 'career_decision_continue'],
        processing_status: 'completed',
        origin: 'user',
        extraction_summary: 'The current decision is to gather evidence on the call and use a weighted scorecard before continuing.',
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
        source_refs: ['src_career_priorities', 'src_career_finance_snapshot'],
        x: 80,
        y: 80,
      }),
      node({
        id: 'career_growth_goal',
        type: 'GOAL',
        text: 'Move toward meaningful backend or applied AI ownership',
        status: 'OPEN',
        confidence: 1,
        impact: 0.88,
        source_refs: ['src_career_priorities'],
        x: 80,
        y: 210,
      }),
      node({
        id: 'career_preference_frontend',
        type: 'PREFERENCE',
        text: 'Avoid positions dominated by frontend delivery',
        status: 'RESOLVED',
        confidence: 1,
        impact: 0.94,
        source_refs: ['src_career_priorities'],
        x: 300,
        y: 80,
      }),
      node({
        id: 'career_preference_hybrid',
        type: 'PREFERENCE',
        text: 'Prefer remote work or no more than two office days per week',
        status: 'RESOLVED',
        confidence: 1,
        impact: 0.72,
        source_refs: ['src_career_priorities'],
        x: 300,
        y: 180,
      }),
      node({
        id: 'career_role_frontend',
        type: 'KNOWN',
        text: 'The job document describes the position as 70–80% frontend during the first year',
        status: 'RESOLVED',
        confidence: 0.96,
        impact: 0.97,
        priority: 0.97,
        source_refs: [CAREER_CONFLICT_JOB_SOURCE_ID],
        x: 300,
        y: 290,
      }),
      node({
        id: 'career_first_90_days',
        type: 'EVIDENCE',
        text: 'The first 90-day objective is to lead the customer-dashboard redesign',
        status: 'RESOLVED',
        confidence: 0.94,
        impact: 0.84,
        source_refs: [CAREER_CONFLICT_JOB_SOURCE_ID],
        x: 300,
        y: 390,
      }),
      node({
        id: 'career_hybrid_schedule',
        type: 'KNOWN',
        text: 'The posting describes a hybrid schedule but does not state the required office days',
        status: 'RESOLVED',
        confidence: 0.9,
        impact: 0.68,
        source_refs: [CAREER_CONFLICT_JOB_SOURCE_ID],
        x: 300,
        y: 490,
      }),
      node({
        id: 'career_salary_range',
        type: 'KNOWN',
        text: 'The published base salary range is $155,000–$175,000 with a 10% target bonus',
        status: 'RESOLVED',
        confidence: 0.98,
        impact: 0.95,
        priority: 0.95,
        source_refs: ['src_career_compensation'],
        x: 300,
        y: 590,
      }),
      node({
        id: 'career_benefits_start',
        type: 'EVIDENCE',
        text: 'Medical coverage begins on day one and the retirement match begins after 90 days',
        status: 'RESOLVED',
        confidence: 0.96,
        impact: 0.7,
        source_refs: ['src_career_compensation'],
        x: 300,
        y: 690,
      }),
      node({
        id: 'career_cash_runway',
        type: 'KNOWN',
        text: 'Current savings cover approximately five months of fixed expenses',
        status: 'RESOLVED',
        confidence: 0.98,
        impact: 0.96,
        priority: 0.96,
        source_refs: ['src_career_finance_snapshot'],
        x: 80,
        y: 340,
      }),
      node({
        id: 'career_income_timeline',
        type: 'CONSTRAINT',
        text: 'Contract income ends in six weeks and the target is stable employment within ten weeks',
        status: 'RESOLVED',
        confidence: 0.98,
        impact: 0.93,
        priority: 0.93,
        source_refs: ['src_career_finance_snapshot'],
        x: 80,
        y: 450,
      }),
      node({
        id: 'career_call_timing',
        type: 'CONSTRAINT',
        text: 'The recruiter call is scheduled within 24 hours',
        status: 'RESOLVED',
        confidence: 0.98,
        impact: 0.92,
        priority: 0.92,
        source_refs: [CAREER_CONFLICT_RECRUITER_SOURCE_ID],
        x: 80,
        y: 560,
      }),
      node({
        id: 'career_company_stage',
        type: 'KNOWN',
        text: 'Northstar Labs is a Series C company with roughly 45 engineers',
        status: 'RESOLVED',
        confidence: 0.82,
        impact: 0.68,
        source_refs: ['src_career_company_research'],
        x: 300,
        y: 790,
      }),
      node({
        id: 'career_team_shape',
        type: 'EVIDENCE',
        text: 'The product team has five product engineers and one shared platform engineer',
        status: 'RESOLVED',
        confidence: 0.86,
        impact: 0.82,
        source_refs: ['src_career_team_notes'],
        x: 300,
        y: 890,
      }),
      node({
        id: 'career_risk_financial_pressure',
        type: 'RISK',
        text: 'Financial urgency could make a well-paid but unsustainable position look safer than it is',
        status: 'OPEN',
        confidence: 0.68,
        impact: 0.94,
        priority: 0.94,
        source_refs: ['src_career_finance_snapshot', 'src_career_priorities'],
        why_it_matters: ['A short-lived mismatch would undermine the financial stability goal and restart the search.'],
        x: 520,
        y: 80,
      }),
      node({
        id: 'career_risk_ai_path',
        type: 'RISK',
        text: 'The hoped-for backend or applied AI path is not staffed or documented',
        status: 'OPEN',
        confidence: 0.42,
        impact: 0.88,
        priority: 0.86,
        source_refs: ['src_career_company_research'],
        why_it_matters: ['A vague future transfer should not be treated as compensation for a frontend-heavy first year.'],
        x: 520,
        y: 180,
      }),
      node({
        id: 'assumption_career_backend_path',
        type: 'ASSUMPTION',
        text: 'A backend or applied AI transfer could become available after six months',
        status: 'OPEN',
        confidence: 0.28,
        impact: 0.8,
        priority: 0.78,
        source_refs: ['src_career_company_research'],
        why_it_matters: ['The role is more attractive only if there is a credible path beyond frontend delivery.'],
        x: 520,
        y: 280,
      }),
      node({
        id: 'career_decision_take_call',
        type: 'DECISION',
        text: 'Use the recruiter call as due diligence instead of rejecting the opportunity immediately',
        status: 'RESOLVED',
        confidence: 0.96,
        impact: 0.96,
        priority: 0.96,
        source_refs: ['src_career_decision_log'],
        x: 980,
        y: 80,
      }),
      node({
        id: 'career_decision_scorecard',
        type: 'DECISION',
        text: 'Evaluate the opportunity using financial stability, work mix, technical growth, and flexibility',
        status: 'RESOLVED',
        confidence: 0.94,
        impact: 0.88,
        priority: 0.88,
        source_refs: ['src_career_decision_log'],
        x: 980,
        y: 190,
      }),
      node({
        id: 'career_decision_continue',
        type: 'DECISION',
        text: 'Decide whether to continue into the full interview loop',
        status: 'OPEN',
        confidence: 0.22,
        impact: 0.95,
        priority: 0.93,
        source_refs: ['src_career_decision_log'],
        why_it_matters: ['Continuing commits several hours to interviews and technical preparation.'],
        x: 980,
        y: 300,
      }),
      node({
        id: 'career_coach_prep',
        type: 'NEXT_ACTION',
        text: 'Meet with the career coach soon to prepare the recruiter-call strategy',
        status: 'OPEN',
        confidence: 0.98,
        impact: 0.9,
        priority: 0.9,
        source_refs: [CAREER_CONFLICT_PREP_SOURCE_ID],
        why_it_matters: ['The meeting is the nearest commitment and should convert open questions into a call plan.'],
        x: 980,
        y: 420,
      }),
      node({
        id: 'career_prepare_scorecard',
        type: 'NEXT_ACTION',
        text: 'Prepare the weighted scorecard and recruiter questions before the prep meeting',
        status: 'OPEN',
        confidence: 0.94,
        impact: 0.88,
        priority: 0.89,
        source_refs: [CAREER_CONFLICT_PREP_SOURCE_ID, 'src_career_decision_log'],
        why_it_matters: ['A prepared scorecard keeps financial urgency from crowding out role-fit evidence.'],
        x: 980,
        y: 530,
      }),
      node({
        id: 'career_recruiter_call',
        type: 'NEXT_ACTION',
        text: 'Attend the upcoming recruiter call and collect evidence about work mix, growth, compensation, and flexibility',
        status: 'OPEN',
        confidence: 0.95,
        impact: 0.92,
        priority: 0.91,
        source_refs: [CAREER_CONFLICT_RECRUITER_SOURCE_ID],
        why_it_matters: ['The call is the next opportunity to clarify role fit and compensation.'],
        x: 980,
        y: 640,
      }),
      node({
        id: CAREER_CONFLICT_QUESTION_ID,
        type: 'UNKNOWN',
        text: 'Does this primarily frontend role remain acceptable given your preference to avoid frontend-heavy roles?',
        status: 'OPEN',
        confidence: 0.08,
        impact: 0.98,
        priority: 0.99,
        source_refs: [CAREER_CONFLICT_JOB_SOURCE_ID, CAREER_CONFLICT_RECRUITER_SOURCE_ID, 'src_career_priorities'],
        why_it_matters: [
          'This determines whether to prepare for or decline the recruiter call.',
          'It tests how financial stability should be balanced against the user’s role preference.',
        ],
        x: 740,
        y: 80,
      }),
      node({
        id: 'unknown_career_frontend_split',
        type: 'UNKNOWN',
        text: 'What percentage of a normal week is actually frontend delivery after the dashboard launch?',
        status: 'OPEN',
        confidence: 0.2,
        impact: 0.86,
        priority: 0.84,
        source_refs: [CAREER_CONFLICT_JOB_SOURCE_ID, 'src_career_team_notes'],
        why_it_matters: ['The posting gives a first-year estimate but not the steady-state work mix.'],
        x: 740,
        y: 200,
      }),
      node({
        id: 'unknown_career_backend_path',
        type: 'UNKNOWN',
        text: 'Is there a funded, manager-supported path into backend or applied AI ownership?',
        status: 'OPEN',
        confidence: 0.18,
        impact: 0.84,
        priority: 0.82,
        source_refs: ['src_career_company_research', 'src_career_team_notes'],
        why_it_matters: ['A credible transition path determines whether the frontend-heavy first year is a temporary tradeoff.'],
        x: 740,
        y: 320,
      }),
      node({
        id: 'unknown_career_total_compensation',
        type: 'UNKNOWN',
        text: 'What are the equity grant, vesting terms, refresh policy, and total first-year compensation?',
        status: 'OPEN',
        confidence: 0.25,
        impact: 0.8,
        priority: 0.79,
        source_refs: ['src_career_compensation'],
        why_it_matters: ['The cash range supports financial stability, but the total package cannot yet be compared accurately.'],
        x: 740,
        y: 440,
      }),
      node({
        id: 'unknown_career_flexibility',
        type: 'UNKNOWN',
        text: 'How many office days, on-call hours, and after-hours launches are expected?',
        status: 'OPEN',
        confidence: 0.24,
        impact: 0.76,
        priority: 0.75,
        source_refs: [CAREER_CONFLICT_JOB_SOURCE_ID, 'src_career_team_notes'],
        why_it_matters: ['Schedule expectations affect sustainability and the user’s hybrid-work preference.'],
        x: 740,
        y: 560,
      }),
      node({
        id: 'unknown_career_interview_timeline',
        type: 'UNKNOWN',
        text: 'How quickly can the interview loop reach an offer decision?',
        status: 'OPEN',
        confidence: 0.32,
        impact: 0.72,
        priority: 0.71,
        source_refs: ['src_career_interview_process'],
        why_it_matters: ['The timing must be compared with the six-week contract end and ten-week income target.'],
        x: 740,
        y: 680,
      }),
      node({
        id: 'unknown_career_success_metrics',
        type: 'UNKNOWN',
        text: 'What would success look like at 30, 60, and 90 days?',
        status: 'OPEN',
        confidence: 0.3,
        impact: 0.7,
        priority: 0.69,
        source_refs: [CAREER_CONFLICT_JOB_SOURCE_ID, 'src_career_interview_process'],
        why_it_matters: ['Clear expectations reveal whether the position is mostly a UI delivery mandate or a broader engineering role.'],
        x: 740,
        y: 800,
      }),
    ],
    edges: [
      { id: 'career_role_informs_question', source: 'career_role_frontend', target: CAREER_CONFLICT_QUESTION_ID, type: 'informs' },
      { id: 'career_preference_contradicts_role', source: 'career_preference_frontend', target: 'career_role_frontend', type: 'contradicts' },
      { id: 'career_preference_informs_question', source: 'career_preference_frontend', target: CAREER_CONFLICT_QUESTION_ID, type: 'informs' },
      { id: 'career_question_blocks_continue', source: CAREER_CONFLICT_QUESTION_ID, target: 'career_decision_continue', type: 'blocks' },
      { id: 'career_question_blocks_call', source: CAREER_CONFLICT_QUESTION_ID, target: 'career_recruiter_call', type: 'blocks' },
      { id: 'career_question_blocks_prep', source: CAREER_CONFLICT_QUESTION_ID, target: 'career_prepare_scorecard', type: 'blocks' },
      { id: 'career_goal_informs_call', source: 'career_financial_goal', target: 'career_recruiter_call', type: 'informs' },
      { id: 'career_goal_informs_continue', source: 'career_financial_goal', target: 'career_decision_continue', type: 'informs' },
      { id: 'career_growth_informs_continue', source: 'career_growth_goal', target: 'career_decision_continue', type: 'informs' },
      { id: 'career_salary_supports_goal', source: 'career_salary_range', target: 'career_financial_goal', type: 'supports' },
      { id: 'career_runway_informs_decision', source: 'career_cash_runway', target: 'career_decision_continue', type: 'informs' },
      { id: 'career_income_informs_decision', source: 'career_income_timeline', target: 'career_decision_continue', type: 'informs' },
      { id: 'career_pressure_affects_decision', source: 'career_risk_financial_pressure', target: 'career_decision_continue', type: 'affects' },
      { id: 'career_ai_risk_affects_goal', source: 'career_risk_ai_path', target: 'career_growth_goal', type: 'affects' },
      { id: 'career_assumption_informs_backend_question', source: 'assumption_career_backend_path', target: 'unknown_career_backend_path', type: 'informs' },
      { id: 'career_frontend_split_informs_question', source: 'unknown_career_frontend_split', target: CAREER_CONFLICT_QUESTION_ID, type: 'informs' },
      { id: 'career_frontend_split_informs_continue', source: 'unknown_career_frontend_split', target: 'career_decision_continue', type: 'informs' },
      { id: 'career_backend_path_informs_continue', source: 'unknown_career_backend_path', target: 'career_decision_continue', type: 'informs' },
      { id: 'career_comp_informs_continue', source: 'unknown_career_total_compensation', target: 'career_decision_continue', type: 'informs' },
      { id: 'career_flexibility_informs_continue', source: 'unknown_career_flexibility', target: 'career_decision_continue', type: 'informs' },
      { id: 'career_timeline_informs_call', source: 'unknown_career_interview_timeline', target: 'career_recruiter_call', type: 'informs' },
      { id: 'career_success_informs_call', source: 'unknown_career_success_metrics', target: 'career_recruiter_call', type: 'informs' },
      { id: 'career_call_timing_informs_prep', source: 'career_call_timing', target: 'career_prepare_scorecard', type: 'informs' },
      { id: 'career_prep_depends_on_scorecard', source: 'career_coach_prep', target: 'career_prepare_scorecard', type: 'depends_on' },
      { id: 'career_call_depends_on_prep', source: 'career_recruiter_call', target: 'career_coach_prep', type: 'depends_on' },
      { id: 'career_take_call_informs_action', source: 'career_decision_take_call', target: 'career_recruiter_call', type: 'informs' },
      { id: 'career_scorecard_informs_prep', source: 'career_decision_scorecard', target: 'career_prepare_scorecard', type: 'informs' },
      { id: 'career_team_supports_split_question', source: 'career_team_shape', target: 'unknown_career_frontend_split', type: 'supports' },
      { id: 'career_first_90_supports_split_question', source: 'career_first_90_days', target: 'unknown_career_frontend_split', type: 'supports' },
      { id: 'career_hybrid_informs_flexibility', source: 'career_hybrid_schedule', target: 'unknown_career_flexibility', type: 'informs' },
      { id: 'career_hybrid_preference_informs_flexibility', source: 'career_preference_hybrid', target: 'unknown_career_flexibility', type: 'informs' },
    ],
    history: [],
    active_question: null,
  };

  project.clarity_score = calculateClarityScore(project);
  project.active_question = selectTopGap(project, DEFAULT_USER_PROFILE);

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
