import type { PdfExtraction } from '@/lib/context/pdfAnalysis';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { Project } from '@/types/clarity';
import { SafeCalendarEvent } from '@/types/google';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const DEMO_PDF_EXTRACTION: PdfExtraction = {
  summary: 'Demo document about preparing a Gapswise hackathon presentation.',
  nodes: [
    {
      type: 'GOAL',
      text: 'Prepare the Gapswise hackathon presentation',
      confidence: 0.95,
    },
    {
      type: 'UNKNOWN',
      text: 'What is the strongest 4-minute demo scenario?',
      confidence: 0.85,
    },
  ],
};

export function demoCalendarEvents(now = new Date()): SafeCalendarEvent[] {
  const tomorrow = new Date(now.getTime() + DAY);
  tomorrow.setHours(15, 0, 0, 0);
  const daysUntilFriday = ((5 - now.getDay() + 7) % 7) || 7;
  const friday = new Date(now.getTime() + daysUntilFriday * DAY);
  friday.setHours(17, 0, 0, 0);
  return [
    {
      id: 'demo_gapswise_review',
      summary: 'Gapswise Demo Review',
      description: 'Review the target persona and strongest 4-minute demo scenario.',
      start: tomorrow.toISOString(),
      end: new Date(tomorrow.getTime() + HOUR).toISOString(),
    },
    {
      id: 'demo_hackathon_submission',
      summary: 'Hackathon Submission',
      description: 'Submit the Collaborative Partner project.',
      start: friday.toISOString(),
      end: new Date(friday.getTime() + HOUR).toISOString(),
    },
  ].sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
}

/** Calendar fixture used only by the career-conflict demo workflow. */
export function demoCareerConflictCalendarEvents(now = new Date()): SafeCalendarEvent[] {
  const prepStart = new Date(now.getTime() + 90 * 60 * 1000);
  prepStart.setSeconds(0, 0);
  const callStart = new Date(now.getTime() + 22 * HOUR);
  callStart.setMinutes(0, 0, 0);
  return [
    {
      id: 'demo_career_coach_prep',
      summary: 'Career decision prep with Alex',
      description: 'Review the Northstar job document, role-fit conflict, weighted scorecard, and recruiter questions.',
      start: prepStart.toISOString(),
      end: new Date(prepStart.getTime() + 30 * 60 * 1000).toISOString(),
      location: 'Google Meet',
    },
    {
      id: 'demo_career_recruiter_call',
      summary: 'Recruiter call — Northstar Product Engineer',
      description: 'Clarify frontend work mix, backend and applied AI growth, compensation, flexibility, and interview timing.',
      start: callStart.toISOString(),
      end: new Date(callStart.getTime() + 45 * 60 * 1000).toISOString(),
      location: 'Google Meet',
    },
  ].sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
}

export function createLocalDemoProjects(): Project[] {
  const hackathon = createGoldenDemoProject();
  const createdAt = '2026-08-10T12:00:00.000Z';
  const jobSearch: Project = {
    id: 'job_search_demo',
    title: 'Job Search',
    goal: 'Find a backend or AI role with stronger growth and compensation.',
    status: 'active',
    one_sentence_context: 'A focused search for backend and applied AI opportunities.',
    clarity_score: 38,
    created_at: createdAt,
    updated_at: createdAt,
    sources: [
      {
        id: 'src_job_preferences',
        filename: 'job-search-notes.txt',
        type: 'note',
        content: 'Prioritize backend and applied AI roles with meaningful ownership and remote flexibility.',
        extracted_at: createdAt,
        derived_node_ids: ['node_job_goal'],
        processing_status: 'completed',
        extraction_summary: 'Role direction and work preferences for the job search.',
      },
    ],
    nodes: [
      {
        id: 'node_job_goal',
        type: 'GOAL',
        text: 'Find a backend or AI role with stronger growth and compensation',
        status: 'OPEN',
        confidence: 1,
        impact: 0.9,
        source_refs: ['src_job_preferences'],
        created_by: 'user',
        created_at: createdAt,
        updated_at: createdAt,
      },
      {
        id: 'unknown_job_companies',
        type: 'UNKNOWN',
        text: 'Which companies should I prioritize?',
        status: 'OPEN',
        confidence: 0.25,
        impact: 0.82,
        priority: 0.8,
        source_refs: ['src_job_preferences'],
        why_it_matters: ['A target list is needed before outreach and application effort can be focused.'],
        created_by: 'agent',
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    edges: [{ id: 'edge_job_gap', source: 'unknown_job_companies', target: 'node_job_goal', type: 'blocks' }],
    history: [],
    active_question: null,
  };
  return [hackathon, jobSearch];
}
