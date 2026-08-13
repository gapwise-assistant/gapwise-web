import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { buildMyWorldGraph, classifyDomain } from '@/lib/world/graph';

describe('My World graph', () => {
  it('classifies common project context into stable domains', () => {
    expect(classifyDomain('recruiter salary financial stability')).toBe('finance');
    expect(classifyDomain('hackathon demo startup project')).toBe('work');
    expect(classifyDomain('calendar meeting deadline follow up')).toBe('operations');
  });

  it('builds domain, project, source, gap, and risk nodes from a project', () => {
    const project = createGoldenDemoProject();
    const graph = buildMyWorldGraph('demo-user', [project]);

    expect(graph.nodes.some((node) => node.type === 'DOMAIN')).toBe(true);
    expect(graph.nodes.some((node) => node.id === `project_${project.id}`)).toBe(true);
    expect(graph.nodes.some((node) => node.id === 'clarity_unknown_target_user' && node.type === 'GAP')).toBe(true);
    expect(graph.nodes.some((node) => node.id === 'clarity_node_risk_latency' && node.type === 'RISK')).toBe(true);
    expect(graph.edges.some((edge) => edge.target === `project_${project.id}` && edge.type === 'contains')).toBe(true);
  });

  it('rolls source, gap, and risk counts into domain summaries', () => {
    const graph = buildMyWorldGraph('demo-user', [createGoldenDemoProject()]);
    const activeDomain = graph.domains[0];

    expect(activeDomain.project_count).toBeGreaterThanOrEqual(1);
    expect(activeDomain.source_count).toBeGreaterThanOrEqual(4);
    expect(activeDomain.open_gap_count).toBeGreaterThanOrEqual(2);
    expect(activeDomain.risk_count).toBeGreaterThanOrEqual(1);
  });
});
