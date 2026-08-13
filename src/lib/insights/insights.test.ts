import { beforeEach, describe, expect, it } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { ClarityNode, Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { createDurableMemory } from '@/lib/memory/policy';
import { detectLooseEnds } from '@/lib/insights/looseEnds';
import { detectContextConflicts } from '@/lib/insights/conflicts';
import { detectStaleContext } from '@/lib/insights/stale';
import { applyInsightAction, clearDismissedInsightsForTests } from '@/lib/insights/common';
import { forgetMemory } from '@/lib/memory/store';
import { generateDailyBrief, clearBriefStoreForTests } from '@/lib/attention/generateBrief';

function addNode(project: Project, node: Partial<ClarityNode> & Pick<ClarityNode, 'id' | 'type' | 'text'>) {
  project.nodes.push({
    status: 'OPEN',
    confidence: 0.7,
    impact: 0.8,
    source_refs: [],
    created_by: 'user',
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
    ...node,
  });
}

describe('insight detectors', () => {
  beforeEach(() => {
    clearDismissedInsightsForTests();
    clearBriefStoreForTests();
  });

  it('detects a pending recruiter response as a loose end when tied to active goals', () => {
    const project = createGoldenDemoProject();
    project.sources.push({
      id: 'src_recruiter',
      filename: 'recruiter-email.txt',
      type: 'text',
      content: 'Recruiter asked for a reply about a better-paying AI role.',
      extracted_at: '2026-08-01T10:00:00Z',
      derived_node_ids: [],
      processing_status: 'completed',
    });

    const insights = detectLooseEnds({
      userId: 'demo-user',
      project,
      memories: [createDurableMemory('Financial stability is my top priority for the next 3 months.')!],
      now: new Date('2026-08-10T10:00:00Z'),
    });

    expect(insights[0].title).toBe('Pending recruiter response');
  });

  it('does not trigger contradiction for compatible target-persona statements', () => {
    const project = createGoldenDemoProject();
    addNode(project, {
      id: 'persona_a',
      type: 'DECISION',
      text: 'Primary target persona is a hackathon builder under deadline.',
    });
    addNode(project, {
      id: 'persona_b',
      type: 'KNOWN',
      text: 'The target user is a builder under deadline preparing a hackathon demo scenario.',
    });

    const insights = detectContextConflicts({ userId: 'demo-user', project, memories: [] });

    expect(insights).toHaveLength(0);
  });

  it('detects conflicting target-persona statements with both evidence node IDs', () => {
    const project = createGoldenDemoProject();
    addNode(project, {
      id: 'persona_founder',
      type: 'DECISION',
      text: 'Primary target persona is a startup founder.',
    });
    addNode(project, {
      id: 'persona_student',
      type: 'DECISION',
      text: 'Primary target persona is a student researcher.',
    });

    const insights = detectContextConflicts({ userId: 'demo-user', project, memories: [] });

    expect(insights).toHaveLength(1);
    expect(insights[0].evidence.node_ids).toEqual(['persona_founder', 'persona_student']);
  });

  it('explicit priority change can supersede old priority by excluding forgotten memory from ranking', () => {
    const project = createGoldenDemoProject();
    project.sources.push({
      id: 'src_recruiter',
      filename: 'recruiter-email.txt',
      type: 'text',
      content: 'Recruiter asked about a better-paying AI role.',
      extracted_at: '2026-08-10T12:00:00Z',
      derived_node_ids: [],
      processing_status: 'completed',
    });
    const oldPriority = createDurableMemory('Financial stability is my top priority for the next 3 months.')!;
    const active = generateDailyBrief({ userId: 'demo-user', project, memories: [oldPriority], period: '2026-08-10', force: true });
    const forgotten = forgetMemory([oldPriority], oldPriority.id);
    const reranked = generateDailyBrief({ userId: 'demo-user', project, memories: forgotten, period: '2026-08-10', force: true });

    expect(active.recommendations[0].id).toBe('rec_recruiter_src_recruiter');
    expect(reranked.recommendations[0].id).not.toBe('rec_recruiter_src_recruiter');
  });

  it('surfaces stale volatile memory only after the threshold', () => {
    const staleMemory: DurableMemory = {
      id: 'mem_priority',
      category: 'current_priorities',
      text: 'Financial stability is my top priority.',
      source: 'explicit',
      source_refs: [],
      confidence: 0.9,
      created_at: '2026-07-01T10:00:00Z',
      updated_at: '2026-07-01T10:00:00Z',
      last_confirmed_at: '2026-07-01T10:00:00Z',
      why_remembered: 'Explicit priority.',
    };

    const early = detectStaleContext({
      userId: 'demo-user',
      project: createGoldenDemoProject(),
      memories: [staleMemory],
      now: new Date('2026-07-15T10:00:00Z'),
      ttlDays: 30,
    });
    const late = detectStaleContext({
      userId: 'demo-user',
      project: createGoldenDemoProject(),
      memories: [staleMemory],
      now: new Date('2026-08-10T10:00:00Z'),
      ttlDays: 30,
    });

    expect(early).toHaveLength(0);
    expect(late.some((insight) => insight.type === 'STALE_CONTEXT')).toBe(true);
  });

  it('dismissed false positives are not repeatedly surfaced without new evidence', () => {
    const project = createGoldenDemoProject();
    project.sources.push({
      id: 'src_recruiter',
      filename: 'recruiter-email.txt',
      type: 'text',
      content: 'Recruiter asked for a reply about a better-paying AI role.',
      extracted_at: '2026-08-01T10:00:00Z',
      derived_node_ids: [],
      processing_status: 'completed',
    });
    const first = detectLooseEnds({
      userId: 'demo-user',
      project,
      memories: [createDurableMemory('Financial stability is my top priority for the next 3 months.')!],
      now: new Date('2026-08-10T10:00:00Z'),
    })[0];

    applyInsightAction(first, 'dismiss');

    const second = detectLooseEnds({
      userId: 'demo-user',
      project,
      memories: [createDurableMemory('Financial stability is my top priority for the next 3 months.')!],
      now: new Date('2026-08-10T10:00:00Z'),
    });

    expect(second.some((insight) => insight.id === first.id)).toBe(false);
  });
});
