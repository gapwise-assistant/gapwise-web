import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { buildCurrentPicture, buildNeedsAttention } from '@/lib/projects/projectOverview';

describe('project current picture', () => {
  it('summarizes useful project state without exposing raw graph relationships', () => {
    const picture = buildCurrentPicture(createGoldenDemoProject());
    const text = picture.map((item) => item.text).join(' ');

    expect(picture).toHaveLength(3);
    expect(text).toContain('Two developers have 14 days until the final deadline.');
    expect(text).toContain('Live-demo latency from RAG ingestion and Gemini calls remains a delivery risk.');
    expect(text).toContain('The submission must demonstrate stateful multi-turn dialogue, persistent memory, and clarifying questions.');
    expect(text).not.toMatch(/primary target persona|next decision|\b(is blocking|depends on|supports|contradicts)\b/i);
    expect(text).not.toMatch(/src_|node_/);
  });

  it('surfaces only the highest-value actionable UNKNOWN blocker', () => {
    const project = createGoldenDemoProject();
    project.nodes.push({
      id: 'unknown_secondary_blocker',
      type: 'UNKNOWN',
      text: 'What is the secondary launch channel?',
      status: 'OPEN',
      confidence: 0.4,
      impact: 0.5,
      priority: 0.5,
      source_refs: [],
      created_by: 'agent',
      created_at: project.created_at,
      updated_at: project.updated_at,
    });
    project.edges.push({
      id: 'secondary_block',
      source: 'unknown_secondary_blocker',
      target: 'node_decision_track',
      type: 'blocks',
    });

    expect(buildNeedsAttention(project)).toEqual({
      nodeId: 'unknown_target_user',
      title: 'Target persona and demo scenario are still undefined.',
      detail: 'This is currently blocking the next product decision.',
    });
  });

  it('does not surface an unresolved question that is not blocking a decision or next action', () => {
    const project = createGoldenDemoProject();
    project.edges = project.edges.filter((edge) => edge.source !== 'unknown_target_user');

    expect(buildNeedsAttention(project)).toBeNull();
  });

  it('falls back to the project goal when no graph state exists', () => {
    const project = createGoldenDemoProject();
    project.nodes = [];
    project.edges = [];

    expect(buildCurrentPicture(project)).toEqual([
      expect.objectContaining({ text: expect.stringContaining(project.goal) }),
    ]);
  });
});
