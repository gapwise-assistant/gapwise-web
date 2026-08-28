import { describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { retireExplicitlyDisprovedRisks } from '@/lib/graph/riskLifecycle';
import type { ClarityNode } from '@/types/clarity';

function node(id: string, type: ClarityNode['type'], status: ClarityNode['status']): ClarityNode {
  return {
    id,
    type,
    text: id,
    status,
    confidence: 0.9,
    impact: 0.8,
    source_refs: [],
    created_by: 'agent',
    created_at: '2026-08-28T00:00:00.000Z',
    updated_at: '2026-08-28T00:00:00.000Z',
  };
}

describe('risk lifecycle', () => {
  it('retires a risk only when resolved evidence explicitly invalidates it', () => {
    const project = createProjectFromInput({ name: 'Pilot', goal: 'Launch safely.' });
    project.nodes.push(node('confirmed-control', 'KNOWN', 'RESOLVED'), node('control-risk', 'RISK', 'OPEN'));
    project.edges.push({
      id: 'invalidates-risk',
      source: 'confirmed-control',
      target: 'control-risk',
      type: 'contradicts',
      confidence: 0.9,
    });

    expect(retireExplicitlyDisprovedRisks(project)).toEqual(['control-risk']);
    expect(project.nodes.find((candidate) => candidate.id === 'control-risk')?.status).toBe('DEPRECATED');
  });

  it('does not infer risk closure from an ordinary relationship or unresolved evidence', () => {
    const project = createProjectFromInput({ name: 'Pilot', goal: 'Launch safely.' });
    project.nodes.push(node('possible-control', 'EVIDENCE', 'OPEN'), node('control-risk', 'RISK', 'OPEN'));
    project.edges.push({ id: 'informs-risk', source: 'possible-control', target: 'control-risk', type: 'informs' });

    expect(retireExplicitlyDisprovedRisks(project)).toEqual([]);
    expect(project.nodes.find((candidate) => candidate.id === 'control-risk')?.status).toBe('OPEN');
  });
});
