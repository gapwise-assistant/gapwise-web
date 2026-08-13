import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { createDurableMemory } from '@/lib/memory/policy';
import { activeGoals, currentPriorities, unresolvedPersonalQuestions, userLevelUnresolvedQuestions } from '@/lib/you/sections';

describe('You section selectors', () => {
  it('shows current priorities only from active durable memory', () => {
    const priority = createDurableMemory('Financial stability is my top priority for the next 3 months.')!;
    const preference = createDurableMemory('Remember that concise answers are my preference.')!;

    expect(currentPriorities([priority, preference])).toEqual([
      expect.objectContaining({ id: priority.id }),
    ]);
  });

  it('shows active goals from the existing graph', () => {
    const project = createGoldenDemoProject();

    expect(activeGoals(project)).toEqual([
      expect.objectContaining({
        id: 'node_goal',
        type: 'GOAL',
      }),
    ]);
  });

  it('shows unresolved questions only from existing open unknown or assumption nodes', () => {
    const project = createGoldenDemoProject();
    project.nodes.push({
      id: 'resolved_unknown',
      type: 'UNKNOWN',
      text: 'This is already resolved?',
      status: 'RESOLVED',
      confidence: 1,
      impact: 0.9,
      source_refs: [],
      created_by: 'agent',
      created_at: '2026-08-11T10:00:00Z',
      updated_at: '2026-08-11T10:00:00Z',
    });

    const questions = unresolvedPersonalQuestions(project);

    expect(questions.some((node) => node.id === 'unknown_target_user')).toBe(true);
    expect(questions.some((node) => node.id === 'node_assumption_visual')).toBe(true);
    expect(questions.some((node) => node.id === 'resolved_unknown')).toBe(false);
  });

  it('keeps project-specific questions out of top-level user questions', () => {
    const project = createGoldenDemoProject();
    project.nodes.push({
      id: 'career_direction',
      type: 'UNKNOWN',
      text: 'What type of role are you ultimately targeting?',
      status: 'OPEN',
      confidence: 0.2,
      impact: 0.9,
      source_refs: [],
      created_by: 'agent',
      created_at: '2026-08-11T10:00:00Z',
      updated_at: '2026-08-11T10:00:00Z',
    });

    const questions = userLevelUnresolvedQuestions([project]);

    expect(questions.some((node) => node.id === 'career_direction')).toBe(true);
    expect(questions.some((node) => node.id === 'unknown_target_user')).toBe(false);
  });
});
