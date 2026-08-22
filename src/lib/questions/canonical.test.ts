import { describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { projectForReasoning } from '@/lib/context/sourceState';
import { rankGaps } from '@/lib/tools/graphTools';
import { canonicalQuestionGroups, reconcileQuestionCandidate } from '@/lib/questions/canonical';
import type { ClarityNode } from '@/types/clarity';

function question(
  id: string,
  text: string,
  status: 'OPEN' | 'RESOLVED',
  sourceRefs: string[],
): ClarityNode {
  return {
    id,
    type: 'UNKNOWN',
    text,
    status,
    confidence: status === 'RESOLVED' ? 1 : 0.35,
    impact: 0.9,
    source_refs: sourceRefs,
    created_by: 'agent',
    created_at: '2026-08-20T10:00:00.000Z',
    updated_at: status === 'RESOLVED' ? '2026-08-21T10:00:00.000Z' : '2026-08-20T10:00:00.000Z',
  };
}

describe('canonical question projection', () => {
  it('groups generic token-containment paraphrases while keeping distinct subjects separate', () => {
    const project = createProjectFromInput({ name: 'Pilot planning', goal: 'Coordinate a safe clinic rollout.' }, '2026-08-20T09:00:00.000Z');
    project.nodes.push(
      question('mri', 'Which MRI time is correct?', 'OPEN', []),
      question('mri_alias', 'What is the correct MRI appointment time?', 'OPEN', []),
      question('medication_budget', 'What is the monthly medication budget for clinic visits?', 'OPEN', []),
      question('transport_budget', 'What is the monthly transport budget for clinic visits?', 'OPEN', []),
      question('clinic_wifi', 'Is clinic Wi-Fi available?', 'OPEN', []),
      question('home_ethernet', 'Can home ethernet be used?', 'OPEN', []),
    );

    const groups = canonicalQuestionGroups(project);
    expect(groups).toHaveLength(5);
    expect(groups.find((group) => group.canonical.id === 'mri')?.nodeIds).toEqual(expect.arrayContaining(['mri', 'mri_alias']));
    expect(groups.find((group) => group.canonical.id === 'medication_budget')?.nodeIds).toEqual(['medication_budget']);
    expect(groups.find((group) => group.canonical.id === 'transport_budget')?.nodeIds).toEqual(['transport_budget']);
    expect(groups.find((group) => group.canonical.id === 'clinic_wifi')?.nodeIds).toEqual(['clinic_wifi']);
    expect(groups.find((group) => group.canonical.id === 'home_ethernet')?.nodeIds).toEqual(['home_ethernet']);
    expect(reconcileQuestionCandidate({ type: 'UNKNOWN', text: 'What is the correct MRI appointment time?' }, project)).toMatchObject({
      classification: 'PARAPHRASE',
      canonicalQuestionId: 'mri',
    });

    const subquestionProject = createProjectFromInput({ name: 'Pilot planning', goal: 'Coordinate a safe clinic rollout.' }, '2026-08-20T09:00:00.000Z');
    subquestionProject.nodes.push(question('launch_date', 'Which launch date is approved for the rollout?', 'OPEN', []));
    expect(reconcileQuestionCandidate({ type: 'UNKNOWN', text: 'Which specific launch date is approved for the rollout?' }, subquestionProject)).toMatchObject({
      classification: 'SUBQUESTION',
      canonicalQuestionId: 'launch_date',
    });
  });

  it('honors an explicit canonical relationship even when lexical similarity is low', () => {
    const project = createProjectFromInput({ name: 'Pilot planning', goal: 'Coordinate a safe clinic rollout.' }, '2026-08-20T09:00:00.000Z');
    project.nodes.push(
      question('root', 'Which MRI time is correct?', 'OPEN', []),
      {
        ...question('explicit_alias', 'What amount is allocated to transportation each month?', 'OPEN', []),
        canonical_question_id: 'root',
        question_role: 'alias',
        reconciliation_status: 'reconciled',
      },
    );

    expect(canonicalQuestionGroups(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonical: expect.objectContaining({ id: 'root' }), nodeIds: ['root', 'explicit_alias'] }),
    ]));
  });

  it('collapses legacy semantic aliases and rewires their decision edges', () => {
    const project = createProjectFromInput({ name: 'ClinicFlow', goal: 'Make the pilot decision.' }, '2026-08-20T09:00:00.000Z');
    project.sources.push(
      {
        id: 'brief', filename: '01 Pilot Brief', type: 'text', content: '', extracted_at: '2026-08-20T09:00:00.000Z',
        derived_node_ids: ['authority_a'],
      },
      {
        id: 'steering', filename: '02 Steering Update', type: 'text', content: '', extracted_at: '2026-08-21T09:00:00.000Z',
        derived_node_ids: ['authority_b'],
      },
    );
    project.nodes.push(
      question('authority_a', 'Who has final clinical accountability and legal authority to correct medication or allergy information?', 'OPEN', ['brief']),
      {
        ...question('authority_b', 'Dr. Maya Chen has not accepted clinical accountability for medication and allergy corrections.', 'OPEN', ['steering']),
        canonical_question_id: 'authority_a',
        question_role: 'alias',
      },
      {
        id: 'decision_launch', type: 'DECISION', text: 'Choose the ClinicFlow pilot option.', status: 'OPEN', confidence: 0.9, impact: 0.95,
        source_refs: ['brief', 'steering'], created_by: 'agent', created_at: '2026-08-20T09:00:00.000Z', updated_at: '2026-08-21T09:00:00.000Z',
      },
    );
    project.edges.push(
      { id: 'edge_a', source: 'authority_a', target: 'decision_launch', type: 'blocks' },
      { id: 'edge_b', source: 'authority_b', target: 'decision_launch', type: 'blocks' },
    );

    const reasoning = projectForReasoning(project);
    const questions = reasoning.nodes.filter((node) => node.type === 'UNKNOWN');

    expect(questions).toHaveLength(1);
    expect(questions[0]?.id).toBe('authority_a');
    expect(questions[0]?.source_refs).toEqual(expect.arrayContaining(['brief', 'steering']));
    expect(reasoning.edges.filter((edge) => edge.type === 'blocks')).toHaveLength(1);
    expect(reasoning.edges[0]).toMatchObject({ source: 'authority_a', target: 'decision_launch' });
    expect(reasoning.sources.find((source) => source.id === 'steering')?.derived_node_ids).toEqual(['authority_a']);
    expect(rankGaps(project).filter((gap) => gap.node_id === 'authority_a')).toHaveLength(1);
    expect(rankGaps(project).some((gap) => gap.node_id === 'authority_b')).toBe(false);
  });

  it('honors an explicit related-but-distinct boundary instead of broad family matching', () => {
    const project = createProjectFromInput({ name: 'Quiet PC', goal: 'Build a quiet workstation.' }, '2026-08-20T09:00:00.000Z');
    project.nodes.push(
      question('fit_root', 'Will the selected graphics card and cooler fit while keeping noise acceptable?', 'OPEN', []),
      {
        ...question('fit_related', 'Will the case remain quiet during video calls?', 'OPEN', []),
        question_role: 'related',
        reconciliation_status: 'reconciled',
        reconciliation_reason: 'The answer changes acoustic setup independently from physical clearance.',
      },
    );

    expect(canonicalQuestionGroups(project)).toHaveLength(2);
  });

  it('selects the reconciled model wording over a malformed status fallback', () => {
    const project = createProjectFromInput({ name: 'Surgery preparation', goal: 'Complete preparation.' }, '2026-08-20T09:00:00.000Z');
    project.nodes.push(
      {
        ...question('model_authorization', 'Has the insurance company approved the procedure authorization, or what was the outcome of the review expected by October 9?', 'OPEN', ['surgery']),
        reconciliation_status: 'reconciled',
      },
      {
        ...question('fallback_authorization', 'What current status is recorded for insurance company told me the procedure authorization?', 'OPEN', ['surgery']),
        reconciliation_status: 'fallback',
      },
    );

    const groups = canonicalQuestionGroups(project);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.canonical.text).toContain('Has the insurance company approved');
    const reasoningQuestions = projectForReasoning(project).nodes.filter((node) => node.type === 'UNKNOWN');
    expect(reasoningQuestions).toHaveLength(1);
    expect(reasoningQuestions[0]?.text).toContain('Has the insurance company approved');
    expect(rankGaps(project).some((gap) => /insurance company told me/i.test(gap.question))).toBe(false);
  });

  it('lets a resolved equivalent suppress an older open alias everywhere in reasoning', () => {
    const project = createProjectFromInput({ name: 'ClinicFlow', goal: 'Make the pilot decision.' }, '2026-08-20T09:00:00.000Z');
    project.nodes.push(
      question('retry_open', 'Can the offline queue retry without creating duplicate EHR records?', 'OPEN', []),
      {
        ...question('retry_resolved', 'The offline retry test confirmed the connector cannot avoid duplicate EHR records.', 'RESOLVED', ['retry-test']),
        canonical_question_id: 'retry_open',
        question_role: 'alias',
      },
    );

    const reasoning = projectForReasoning(project);
    expect(reasoning.nodes.filter((node) => node.type === 'UNKNOWN')).toHaveLength(1);
    expect(reasoning.nodes.find((node) => node.type === 'UNKNOWN')?.status).toBe('RESOLVED');
    expect(rankGaps(project).some((gap) => /offline queue/i.test(gap.question))).toBe(false);
  });
});
