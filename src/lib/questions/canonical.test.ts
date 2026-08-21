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
  it('groups PC-build paraphrases by uncertainty family while keeping decisions distinct', () => {
    const project = createProjectFromInput({ name: 'Quiet PC', goal: 'Build a quiet workstation.' }, '2026-08-20T09:00:00.000Z');
    project.nodes.push(
      question('gpu', 'Which GPU best fits gaming, Blender, and local AI?', 'OPEN', []),
      question('psu', 'Can the existing 650 W power supply safely run the selected GPU?', 'OPEN', []),
      question('fit', 'Will the selected graphics card and cooler fit while keeping noise acceptable?', 'OPEN', []),
      question('budget', 'Can the final configuration stay under $1,600 after tax and shipping?', 'OPEN', []),
      question('ram', 'Is 32 GB enough for Blender scenes and local AI, or is 64 GB required?', 'OPEN', []),
      question('bios', 'Has the retailer confirmed the motherboard BIOS supports the CPU?', 'OPEN', []),
      question('wifi', 'Does the build need built-in Wi-Fi?', 'OPEN', []),
      question('psu_alias', 'Is the old 650 W PSU safe for the chosen GPU?', 'OPEN', []),
      question('fit_alias', 'Can the RTX 5070 and CPU cooler fit without unacceptable heat or noise?', 'OPEN', []),
      question('budget_alias', 'Does the $1,472 balanced quote remain below $1,600 after shipping?', 'OPEN', []),
      question('ram_alias', 'Is 32 GB enough for the largest Blender scene plus a local model?', 'OPEN', []),
    );

    const groups = canonicalQuestionGroups(project);
    expect(groups).toHaveLength(7);
    expect(groups.find((group) => group.canonical.id === 'psu')?.nodeIds).toEqual(expect.arrayContaining(['psu', 'psu_alias']));
    const subquestionProject = createProjectFromInput({ name: 'Quiet PC', goal: 'Build a quiet workstation.' }, '2026-08-20T09:00:00.000Z');
    subquestionProject.nodes.push(question('fit_root', 'Will the selected graphics card and cooler fit while keeping noise acceptable?', 'OPEN', []));
    expect(reconcileQuestionCandidate({ type: 'UNKNOWN', text: 'Can the RTX 5070 and cooler fit in the case?' }, subquestionProject)).toMatchObject({
      classification: 'SUBQUESTION',
      canonicalQuestionId: 'fit_root',
    });
    expect(reconcileQuestionCandidate({
      type: 'UNKNOWN',
      text: 'Will the PC run too hot or loud inside the tightly constrained desk opening?',
    }, subquestionProject)).toMatchObject({
      classification: 'SUBQUESTION',
      canonicalQuestionId: 'fit_root',
    });
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
      question('authority_b', 'Dr. Maya Chen has not accepted clinical accountability for medication and allergy corrections.', 'OPEN', ['steering']),
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

  it('lets a resolved equivalent suppress an older open alias everywhere in reasoning', () => {
    const project = createProjectFromInput({ name: 'ClinicFlow', goal: 'Make the pilot decision.' }, '2026-08-20T09:00:00.000Z');
    project.nodes.push(
      question('retry_open', 'Can the offline queue retry without creating duplicate EHR records?', 'OPEN', []),
      question('retry_resolved', 'The offline retry test confirmed the connector cannot avoid duplicate EHR records.', 'RESOLVED', ['retry-test']),
    );

    const reasoning = projectForReasoning(project);
    expect(reasoning.nodes.filter((node) => node.type === 'UNKNOWN')).toHaveLength(1);
    expect(reasoning.nodes.find((node) => node.type === 'UNKNOWN')?.status).toBe('RESOLVED');
    expect(rankGaps(project).some((gap) => /offline queue/i.test(gap.question))).toBe(false);
  });
});
