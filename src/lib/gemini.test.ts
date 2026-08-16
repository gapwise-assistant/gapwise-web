import { describe, expect, it } from 'vitest';
import { previewIdontKnowContext, processIdontKnowStrategy } from '@/lib/questions/idontKnowStrategies';
import type { Project, UserMemoryProfile } from '@/types/clarity';

const profile: UserMemoryProfile = {
  answer_density: 'concise',
  question_frequency: 'moderate',
  challenge_level: 'high',
  evidence_preference: 'research_first',
  brainstorm_style: 'direct_to_solution',
  uncertainty_style: 'explicit',
};

function projectWithGap(content = 'Northstar is primarily frontend, with roughly 80% frontend work.'): Project {
  const now = '2026-08-16T12:00:00.000Z';
  const question = 'Is the Northstar role acceptable given the preference to avoid frontend-heavy work?';
  return {
    id: 'project-1', title: 'Career transition', goal: 'Choose a role that supports financial stability.', clarity_score: 20,
    nodes: [{ id: 'question-1', type: 'UNKNOWN', text: question, status: 'OPEN', confidence: 0.2, impact: 0.9, source_refs: ['source-1'], created_by: 'agent', created_at: now, updated_at: now }],
    edges: [],
    sources: [{ id: 'source-1', filename: 'northstar-role.pdf', type: 'pdf', content, extracted_at: now, derived_node_ids: ['question-1'], processing_status: 'completed' }],
    active_question: { node_id: 'question-1', question, uncertainty: 0.8, downstream_impact: 0.9, dependency_count: 1, urgency: 0.8, answerability: 0.7, user_relevance: 0.9, interruption_cost: 0.2, priority: 0.88, reasons: ['This affects the next decision.'], blocked_decision_ids: [] },
    history: [], created_at: now, updated_at: now,
  };
}

describe('RAG unresolved-question strategy', () => {
  it('previews relevant sources without changing graph state', () => {
    const project = projectWithGap();
    const preview = previewIdontKnowContext(project);
    expect(preview.findings[0]?.title).toBe('northstar-role.pdf');
    expect(preview.proposedChange).toContain('Evidence node');
    expect(project.nodes).toHaveLength(1);
  });

  it('adds accepted evidence while leaving the judgment question open', async () => {
    const result = await processIdontKnowStrategy(projectWithGap(), 'rag', profile);
    const evidence = result.updatedProject.nodes.find((node) => node.type === 'EVIDENCE');
    expect(result.didChange).toBe(true);
    expect(result.changedNodeId).toBe(evidence?.id);
    expect(result.updatedProject.nodes.find((node) => node.id === 'question-1')?.status).toBe('OPEN');
    expect(result.updatedProject.edges).toContainEqual(expect.objectContaining({ source: evidence?.id, target: 'question-1', type: 'informs' }));
  });
});
