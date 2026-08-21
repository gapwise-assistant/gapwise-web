import type { PdfExtraction } from '@/lib/context/pdfAnalysis';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { Project } from '@/types/clarity';
import { SafeCalendarEvent } from '@/types/google';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const DEMO_PDF_EXTRACTION: PdfExtraction = {
  summary: 'Demo document about preparing a Gapwise hackathon presentation.',
  reconciliation: [],
  nodes: [
    {
      type: 'GOAL',
      text: 'Prepare the Gapwise hackathon presentation',
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
      summary: 'Gapwise Demo Review',
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
  const callStart = new Date(now.getTime() + 2 * HOUR);
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

/** Calendar fixture used only by the KintaGen scientific-assistant demo. */
export function demoKintaGenCalendarEvents(now = new Date()): SafeCalendarEvent[] {
  const event = (id: string, summary: string, description: string, offsetMs: number, durationMs: number) => {
    const start = new Date(now.getTime() + offsetMs);
    start.setSeconds(0, 0);
    return { id, summary, description, start: start.toISOString(), end: new Date(start.getTime() + durationMs).toISOString(), location: 'Google Meet' };
  };
  return [
    event('demo_kintagen_architecture_review', 'KintaGen lab architecture review', 'Choose the first end-to-end scientific workflow, owners, security gates, and success metrics.', 2 * HOUR, 60 * 60 * 1000),
    event('demo_kintagen_northshore_pilot', 'Pilot call — Northshore Metabolomics Lab', 'Confirm de-identified GC-MS data, reviewer export fields, and the scientist who will validate MoNA matches.', DAY + 3 * HOUR, 45 * 60 * 1000),
    event('demo_kintagen_provenance_review', 'Flow provenance design review', 'Decide which encrypted metadata and result CIDs may be written to the KintaGen project logbook.', 2 * DAY + 2 * HOUR, 45 * 60 * 1000),
    event('demo_kintagen_gcms_validation', 'GC-MS xCMS validation session', 'Review peak thresholds, library version, candidate matches, and uncertainty with a domain scientist.', 3 * DAY + 4 * HOUR, 90 * 60 * 1000),
    event('demo_kintagen_grant_checklist', 'Grant reproducibility checklist', 'Measure automation time, scientist review time, and the fields needed for the next progress report.', 5 * DAY + HOUR, 45 * 60 * 1000),
  ].sort((a, b) => a.start.localeCompare(b.start));
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
