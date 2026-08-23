import { describe, expect, it } from 'vitest';
import { buildQuestionWhyExplanation, relevantSourceExcerpt } from '@/lib/questions/whyQuestion';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import type { TodayQuestion } from '@/lib/today/sections';

function question(nodeId: string): TodayQuestion {
  return {
    id: `question_${nodeId}`,
    question: 'What is the real housing budget?',
    reason: 'It affects the apartment decision.',
    provenance: 'Sources: apartment-search-notes.txt',
    sourceNodeIds: [nodeId],
  };
}

describe('question why explanation', () => {
  it('selects the exact source sentence closest to the graph wording', () => {
    const source = {
      id: 'inspection-note',
      filename: 'Move-out notes',
      type: 'note' as const,
      content: 'The landlord has not confirmed the inspection date. I still need to pack the kitchen.',
      extracted_at: '2026-08-14T10:00:00Z',
      derived_node_ids: [],
    };
    const question = {
      id: 'inspection-question',
      type: 'UNKNOWN' as const,
      text: 'Has the landlord confirmed the inspection date?',
      status: 'OPEN' as const,
      confidence: 0.9,
      impact: 0.9,
      source_refs: [source.id],
      created_by: 'agent' as const,
      created_at: '2026-08-14T10:00:00Z',
      updated_at: '2026-08-14T10:00:00Z',
    };

    expect(relevantSourceExcerpt(source, [question])).toBe('The landlord has not confirmed the inspection date.');
  });

  it('translates graph impact into decision value and named evidence', () => {
    const project = createGoldenDemoProject();
    project.title = 'Housing search';
    const source = {
      id: 'source_apartment_notes',
      filename: 'Apartment search notes',
      type: 'text' as const,
      content: 'Apartment 1: $1,450 plus about $180 utilities. Apartment 2: $1,600 with utilities included and a shorter commute.',
      extracted_at: '2026-08-14T10:00:00Z',
      derived_node_ids: ['housing_budget', 'housing_evidence'],
    };
    const budget = {
      id: 'housing_budget',
      type: 'UNKNOWN' as const,
      text: 'What is the real housing budget?',
      status: 'OPEN' as const,
      confidence: 0.4,
      impact: 0.9,
      source_refs: [source.id],
      created_by: 'agent' as const,
      created_at: '2026-08-14T10:00:00Z',
      updated_at: '2026-08-14T10:00:00Z',
    };
    const decision = {
      id: 'housing_decision',
      type: 'DECISION' as const,
      text: 'Which apartment should I choose?',
      status: 'OPEN' as const,
      confidence: 0.5,
      impact: 0.8,
      source_refs: [],
      created_by: 'agent' as const,
      created_at: '2026-08-14T10:00:00Z',
      updated_at: '2026-08-14T10:00:00Z',
    };
    const evidence = {
      id: 'housing_evidence',
      type: 'EVIDENCE' as const,
      text: 'Two apartments have different all-in costs and commute tradeoffs.',
      status: 'OPEN' as const,
      confidence: 0.9,
      impact: 0.7,
      source_refs: [source.id],
      created_by: 'agent' as const,
      created_at: '2026-08-14T10:00:00Z',
      updated_at: '2026-08-14T10:00:00Z',
    };
    project.nodes.push(budget, decision, evidence);
    project.sources.push(source);
    project.edges.push(
      { id: 'housing_budget_blocks_decision', source: budget.id, target: decision.id, type: 'blocks' },
      { id: 'housing_evidence_supports_budget', source: evidence.id, target: budget.id, type: 'supports' },
      { id: 'housing_decision_affects_goal', source: decision.id, target: 'node_goal', type: 'affects' },
    );

    const explanation = buildQuestionWhyExplanation(project, question(budget.id));

    expect(explanation.whyThisMatters).toContain('blocking the decision “Which apartment should I choose”');
    expect(explanation.whatThisBlocks[0]).toContain('Which apartment should I choose');
    expect(explanation.whatGapswiseKnows).toEqual(expect.arrayContaining([
      'Two apartments have different all-in costs and commute tradeoffs',
      'Apartment 1: $1,450 plus about $180 utilities. Apartment 2: $1,600 with utilities included and a shorter commute.',
    ]));
    expect(explanation.whatCouldChange.join(' ')).toContain('decision: Which apartment should I choose');
    expect(explanation.evidence).toEqual([
      expect.objectContaining({ title: 'Apartment search notes', sourceId: source.id }),
    ]);
    expect(explanation.evidence[0]?.excerpt).toBe(source.content);
    expect(explanation.evidence[0]?.fullText).toBe(source.content);
    expect(JSON.stringify(explanation)).not.toContain('src_');
    expect(explanation.reasoningPath?.nodeIds).toEqual([budget.id, decision.id, 'node_goal']);
  });

  it('explains when the graph has not recorded enough decision context', () => {
    const project = createGoldenDemoProject();
    const orphan = {
      id: 'orphan_question',
      type: 'UNKNOWN' as const,
      text: 'What detail is still missing?',
      status: 'OPEN' as const,
      confidence: 0.3,
      impact: 0.4,
      source_refs: [],
      created_by: 'agent' as const,
      created_at: '2026-08-14T10:00:00Z',
      updated_at: '2026-08-14T10:00:00Z',
    };
    project.nodes.push(orphan);

    const explanation = buildQuestionWhyExplanation(project, question(orphan.id));

    expect(explanation.whatThisBlocks).toEqual([]);
    expect(explanation.whatCouldChange).toEqual([]);
    expect(explanation.evidence).toEqual([]);
    expect(explanation.reasoningPath).toBeNull();
  });

  it('uses a resolved constraint when explaining the answered budget question', () => {
    const project = createGoldenDemoProject();
    const budget = project.nodes.find((node) => node.id === 'unknown_target_user')!;
    budget.text = 'What is your actual affordable monthly housing budget?';
    budget.status = 'RESOLVED';
    const constraint = {
      ...budget,
      id: 'housing_constraint',
      type: 'CONSTRAINT' as const,
      text: 'Housing-related costs should stay at or below $1,750/month.',
      created_by: 'user' as const,
      source_refs: [],
    };
    project.nodes.push(constraint);
    project.edges.push({ id: 'budget_resolved_by_constraint', source: constraint.id, target: budget.id, type: 'resolves' });

    const explanation = buildQuestionWhyExplanation(project, question(budget.id));

    expect(explanation.whatGapswiseKnows).toContain('Housing-related costs should stay at or below $1,750/month');
  });

  it('shows retained subquestions and assumptions under the canonical Resolve view', () => {
    const project = createGoldenDemoProject();
    const canonical = {
      id: 'pc_fit',
      type: 'UNKNOWN' as const,
      text: 'Will the components fit and remain quiet?',
      status: 'OPEN' as const,
      confidence: 0.8,
      impact: 0.9,
      source_refs: [],
      created_by: 'agent' as const,
      created_at: '2026-08-14T10:00:00Z',
      updated_at: '2026-08-14T10:00:00Z',
    };
    project.nodes.push(
      canonical,
      { ...canonical, id: 'pc_fit_gpu', text: 'Can the RTX 5070 fit without unacceptable noise?', question_role: 'subquestion', canonical_question_id: canonical.id },
      { ...canonical, id: 'pc_fit_assumption', text: 'The existing case will keep the build quiet.', type: 'ASSUMPTION', question_role: 'assumption', canonical_question_id: canonical.id },
    );

    const explanation = buildQuestionWhyExplanation(project, {
      ...question(canonical.id),
      question: canonical.text,
    });

    expect(explanation.relatedChecks).toEqual(expect.arrayContaining([
      { kind: 'Subquestion', text: 'Can the RTX 5070 fit without unacceptable noise' },
      { kind: 'Assumption', text: 'The existing case will keep the build quiet' },
    ]));
  });
});
