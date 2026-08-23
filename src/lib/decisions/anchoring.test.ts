import { describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import {
  anchorProjectDecision,
  extractOpenDecisionTitle,
  findDecisionAnchorSuggestion,
  openDecisions,
} from '@/lib/decisions/anchoring';
import { ingestContextSource } from '@/lib/context/ingestion';
import { calculateClarityScore } from '@/lib/prioritization';
import { buildDecisionWorkspace } from '@/lib/decisions/workspace';

describe('decision anchoring', () => {
  it('extracts an explicit pending decision and lets the user anchor it', async () => {
    const initial = createProjectFromInput({
      name: 'ClinicFlow',
      goal: 'Improve outpatient intake without slowing clinicians.',
    }, '2026-08-18T12:00:00.000Z');
    const ingested = await ingestContextSource(initial, {
      sourceId: 'clinic-notes',
      filename: 'clinic-notes.md',
      type: 'text',
      content: 'OPEN DECISION: Should ClinicFlow launch the six-week pilot by November 1?\nThe decision is blocked by whether intake routing is safe and whether clinic managers will adopt it.',
      derivedNodes: [
        {
          type: 'UNKNOWN',
          text: 'Is the intake routing safe enough for the six-week pilot?',
          confidence: 0.45,
          impact: 0.9,
        },
        {
          type: 'UNKNOWN',
          text: 'Will clinic managers adopt the new intake workflow?',
          confidence: 0.5,
          impact: 0.8,
        },
      ],
    }, DEFAULT_USER_PROFILE);
    const suggestion = findDecisionAnchorSuggestion(ingested);

    expect(extractOpenDecisionTitle(ingested.sources[0].content)).toBe(
      'Should ClinicFlow launch the six-week pilot by November 1?'
    );
    expect(extractOpenDecisionTitle('OPEN DECISION: Should ClinicFlow launch the pilot? The choice is blocked by safety data.')).toBe(
      'Should ClinicFlow launch the pilot?'
    );
    expect(suggestion?.questionNodeIds).toHaveLength(2);

    const anchored = anchorProjectDecision(
      ingested,
      suggestion!.title,
      suggestion!.questionNodeIds,
      DEFAULT_USER_PROFILE,
    );
    const decision = anchored.nodes.find((node) => node.type === 'DECISION');

    expect(decision).toMatchObject({
      status: 'OPEN',
      text: 'Should ClinicFlow launch the six-week pilot by November 1?',
    });
    expect(anchored.edges.filter((edge) => edge.target === decision?.id && edge.type === 'blocks')).toHaveLength(2);
    expect(anchored.active_question?.node_id).toBeTruthy();
    expect(anchored.active_question?.blocked_decision_ids).toContain(decision?.id);
    expect(anchored.clarity_score).toBe(calculateClarityScore(anchored));
    const resolved = { ...anchored, nodes: anchored.nodes.map((node) => node.id === decision?.id ? { ...node, status: 'RESOLVED' as const } : node) };
    expect(anchored.clarity_score).toBeLessThanOrEqual(calculateClarityScore(resolved));
  });

  it('does not infer a decision from a generic project note', async () => {
    const project = createProjectFromInput({ name: 'Notes', goal: 'Organize the work.' });
    const updated = await ingestContextSource(project, {
      sourceId: 'generic-note',
      filename: 'plan.txt',
      type: 'text',
      content: 'The team will review the intake workflow next week. There are still unknowns.',
      derivedNodes: [{ type: 'UNKNOWN', text: 'What is the intake workflow success metric?', confidence: 0.4, impact: 0.7 }],
    }, DEFAULT_USER_PROFILE);

    expect(findDecisionAnchorSuggestion(updated)).toBeNull();
    expect(updated.nodes.some((node) => node.type === 'DECISION' && node.status === 'OPEN')).toBe(false);
  });

  it('keeps a pending decision visible to the decision map after ingestion', async () => {
    const project = createProjectFromInput({
      name: 'Demo launch',
      goal: 'Prepare a safe public demo.',
    });
    const updated = await ingestContextSource(project, {
      sourceId: 'retention-note',
      filename: 'retention-note.txt',
      type: 'text',
      content: 'I still need to decide whether submitted files should be retained after the demo.',
    }, DEFAULT_USER_PROFILE);
    const decision = openDecisions(updated)[0];

    expect(decision?.text).toContain('submitted files');
    expect(buildDecisionWorkspace(updated, decision?.id ?? '')?.decision.id).toBe(decision?.id);
  });
});
