import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { IngestSourceInput, PrecomputedSourceNode } from '@/lib/context/ingestion';
import { Project } from '@/types/clarity';

/**
 * A deterministic, multi-document project used by the regression scenario.
 *
 * The fixture deliberately describes a messy real project: the same open
 * questions appear in several notes, evidence conflicts, and a later test
 * resolves one of the launch gates. It is data only; no Gemini/ADK call is
 * needed to run the scenario.
 */
export const CLINICFLOW_REGRESSION_USER_ID = 'clinicflow-regression-user';
export const CLINICFLOW_REGRESSION_PROJECT_ID = 'project_clinicflow-outpatient-intake-pilot_1787216400000';

export const CLINICFLOW_NODE_IDS = {
  decision: 'clinic_decision_launch',
  authority: 'clinic_question_authority',
  retry: 'clinic_question_retry',
  sms: 'clinic_question_sms',
  capacity: 'clinic_question_capacity',
  audit: 'clinic_question_audit',
  riskReversibility: 'clinic_risk_reversibility',
  budget: 'clinic_constraint_budget',
  retryTest: 'clinic_experiment_retry_test',
  retryResult: 'clinic_known_retry_result',
} as const;

export interface ClinicFlowRegressionSource extends IngestSourceInput {
  sourceId: string;
  filename: string;
  type: 'text';
  hash: string;
  extractionHash: string;
  processedAt: string;
  derivedNodes: PrecomputedSourceNode[];
}

const SOURCE_ROOT = path.join(process.cwd(), 'docs', 'test-data', 'clinicflow');

function sourceContent(filename: string): string {
  return readFileSync(path.join(SOURCE_ROOT, filename), 'utf8');
}

function node(
  id: string,
  type: PrecomputedSourceNode['type'],
  text: string,
  impact: number,
  whyItMatters: string[],
  status?: PrecomputedSourceNode['status'],
): PrecomputedSourceNode {
  return {
    id,
    type,
    text,
    confidence: type === 'UNKNOWN' ? 0.42 : 0.92,
    impact,
    status,
    whyItMatters,
  };
}

const questions = {
  authority: 'Who has final clinical accountability and legal authority to correct medication or allergy information after a patient submits it?',
  retry: 'Can the offline queue retry without creating duplicate EHR records?',
  sms: 'Is the SMS consent language approved for PHI-related intake?',
  capacity: 'Can one coordinator safely handle exception review during the Monday peak?',
  audit: 'Does the vendor audit log distinguish patient edits, coordinator edits, and clinician approval?',
};

function baselineSource(
  sourceId: string,
  filename: string,
  hash: string,
  derivedNodes: PrecomputedSourceNode[],
): ClinicFlowRegressionSource {
  return {
    sourceId,
    filename,
    type: 'text',
    content: sourceContent(filename),
    hash,
    extractionHash: hash,
    processedAt: '2026-08-20T15:00:00.000Z',
    extractionSummary: `Deterministic ClinicFlow regression extraction from ${filename}.`,
    processingStatus: 'completed',
    relevance: 'relevant',
    derivedNodes,
  };
}

/** Four baseline documents in the same order a user would normally add them. */
export function clinicFlowBaselineSources(): ClinicFlowRegressionSource[] {
  return [
    baselineSource('clinic_src_pilot_brief', '01-pilot-brief.md', 'clinicflow_hash_01', [
      node(CLINICFLOW_NODE_IDS.decision, 'DECISION', 'Choose the ClinicFlow pilot option for Lakeview.', 0.98, [
        'The September 4 go/no-go decision determines whether any pilot option can launch.',
      ], 'OPEN'),
      node(CLINICFLOW_NODE_IDS.authority, 'UNKNOWN', questions.authority, 0.96, [
        'Clinical accountability and correction authority are required before launch.',
      ]),
      node(CLINICFLOW_NODE_IDS.retry, 'UNKNOWN', questions.retry, 0.95, [
        'Duplicate EHR records are a safety stop condition for every launch option.',
      ]),
      node(CLINICFLOW_NODE_IDS.sms, 'UNKNOWN', questions.sms, 0.93, [
        'Legal approval is required before sending PHI-related intake links by SMS.',
      ]),
      node(CLINICFLOW_NODE_IDS.capacity, 'UNKNOWN', questions.capacity, 0.84, [
        'Peak exception load could increase clinical errors or staff overtime.',
      ]),
      node(CLINICFLOW_NODE_IDS.riskReversibility, 'RISK', 'Patient-data errors or duplicate clinical records are not meaningfully reversible for affected patients.', 0.94, [
        'This conflicts with the sponsor view that a six-week pilot is fully reversible.',
      ]),
      node(CLINICFLOW_NODE_IDS.budget, 'CONSTRAINT', 'The ClinicFlow pilot budget is capped at $45,000 with one integration engineer at 40% capacity and no weekend support.', 0.82, [
        'Budget and capacity limit the safe pilot shape.',
      ]),
    ]),
    baselineSource('clinic_src_clinical_notes', '02-clinical-operations-notes.md', 'clinicflow_hash_02', [
      node(CLINICFLOW_NODE_IDS.authority, 'UNKNOWN', questions.authority, 0.98, [
        'Dr. Maya Chen has not accepted accountability and policy limits medication/allergy corrections.',
      ]),
      node(CLINICFLOW_NODE_IDS.audit, 'UNKNOWN', questions.audit, 0.76, [
        'The audit trail must distinguish patient edits, coordinator edits, and clinical approval.',
      ]),
      node(CLINICFLOW_NODE_IDS.capacity, 'UNKNOWN', questions.capacity, 0.9, [
        'One coordinator covers check-in, calls, and exception review during the Monday peak.',
      ]),
      node('clinic_next_safety_review', 'NEXT_ACTION', 'Hold the 25-minute clinical safety review with the vendor and compliance analyst.', 0.79, [
        'The meeting is the cheapest way to establish ownership, permissions, audit requirements, and stop conditions.',
      ]),
    ]),
    baselineSource('clinic_src_vendor_review', '03-vendor-security-and-commercial-review.md', 'clinicflow_hash_03', [
      node(CLINICFLOW_NODE_IDS.retry, 'UNKNOWN', questions.retry, 0.99, [
        'The vendor has not supplied an idempotency-key specification and Riverside recorded duplicate records.',
      ]),
      node(CLINICFLOW_NODE_IDS.sms, 'UNKNOWN', questions.sms, 0.96, [
        'Legal has not confirmed that the consent language covers digital intake and PHI processing.',
      ]),
      node('clinic_risk_vendor_duplicates', 'RISK', 'The vendor has not demonstrated idempotent retry behavior for the current EHR connector.', 0.92, [
        'A prior Riverside pilot produced 11 duplicate demographic records after queued retries.',
      ]),
      node('clinic_constraint_quote', 'CONSTRAINT', 'The quoted six-week pilot and integration services total $52,000 before optional support, above the approved $45,000 budget.', 0.86, [
        'The pilot may need to be narrowed or re-priced before approval.',
      ]),
    ]),
    baselineSource('clinic_src_steering_update', '04-steering-update-and-decision-log.md', 'clinicflow_hash_04', [
      node(CLINICFLOW_NODE_IDS.decision, 'DECISION', 'Choose the ClinicFlow pilot option for Lakeview.', 0.99, [
        'The steering group did not approve launch; September 4 remains the final decision date.',
      ], 'OPEN'),
      node(CLINICFLOW_NODE_IDS.authority, 'UNKNOWN', questions.authority, 0.99, [
        'If no clinical owner accepts responsibility, the all-patient launch should stop.',
      ]),
      node(CLINICFLOW_NODE_IDS.retry, 'UNKNOWN', questions.retry, 0.99, [
        'The steering sequence requires a 20-record retry test before the go/no-go decision.',
      ]),
      node(CLINICFLOW_NODE_IDS.sms, 'UNKNOWN', questions.sms, 0.98, [
        'Legal approval is a prerequisite for the proposed SMS workflow.',
      ]),
      node(CLINICFLOW_NODE_IDS.capacity, 'UNKNOWN', questions.capacity, 0.86, [
        'The provisional sequence still depends on evidence about peak exception handling.',
      ]),
      node('clinic_next_retry_test', 'NEXT_ACTION', 'Run a 20-record offline retry test and reject the connector if any duplicate is produced.', 0.9, [
        'This is the next technical gate before selecting a pilot option.',
      ]),
    ]),
  ];
}

/** A conclusive follow-up source used to prove a ranking/state transition. */
export function clinicFlowRetryTestSource(): ClinicFlowRegressionSource {
  const content = sourceContent('05-offline-retry-test-results.md');
  return {
    sourceId: 'clinic_src_retry_test_results',
    filename: '05-offline-retry-test-results.md',
    type: 'text',
    content,
    hash: 'clinicflow_hash_05',
    extractionHash: 'clinicflow_hash_05',
    processedAt: '2026-08-21T16:00:00.000Z',
    extractionSummary: 'The 20-record offline retry test produced duplicate EHR records; the current connector is not safe for retry.',
    processingStatus: 'completed',
    relevance: 'relevant',
    derivedNodes: [
      node(CLINICFLOW_NODE_IDS.retryTest, 'EXPERIMENT', 'The 20-record offline retry test produced three duplicate EHR records because the connector accepted an unacknowledged retry as a second write.', 0.98, [
        'This is conclusive evidence that the current connector fails the duplicate-record stop condition.',
      ]),
      node(CLINICFLOW_NODE_IDS.retryResult, 'KNOWN', 'The current EHR connector has no stable idempotency key and cannot be safely used for offline retries before September 15.', 0.98, [
        'The full-patient launch path must be delayed or replaced with read-only integration.',
      ]),
    ],
    relationships: [
      { sourceNodeIndex: 0, targetNodeId: CLINICFLOW_NODE_IDS.retry, type: 'resolves', confidence: 0.99 },
      { sourceNodeIndex: 1, targetNodeId: CLINICFLOW_NODE_IDS.decision, type: 'informs', confidence: 0.92 },
    ],
  };
}

export function createClinicFlowRegressionProject(): Project {
  return createProjectFromInput(
    {
      name: 'ClinicFlow — Outpatient Intake Pilot',
      goal: 'Make a safe, evidence-backed go/no-go decision for the ClinicFlow patient-intake pilot.',
      description: 'A six-week Lakeview pilot with a September 4 decision deadline, safety gates, legal approvals, and a constrained budget.',
      deadline: '2026-09-04',
    },
    '2026-08-20T09:00:00.000Z',
  );
}
