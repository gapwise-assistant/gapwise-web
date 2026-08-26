import { describe, expect, it, afterEach, vi } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import {
  assertHarborLiveEvaluation,
  buildHarborEvaluatorInput,
  duplicatedRepresentedNodeIds,
  evaluateHarborSemanticChecks,
  graphRagPipelineStatus,
  harborAskRouteCheckStatus,
  HARBOR_ASK_SCENARIOS,
  questionRepresentsNode,
  type HarborAskEvaluationTurn,
} from '@/lib/evals/harborGraphRagJourney';
import type { TodayQuestion } from '@/lib/today/sections';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Harbor GraphRAG evaluation guardrails', () => {
  it('requires live AI, explicit cost confirmation, and the dedicated run identity', () => {
    vi.stubEnv('GAPSWISE_DEMO_MODE', 'false');
    vi.stubEnv('GAP_AGENT_MODE', 'live');
    vi.stubEnv('CONFIRM_LIVE_AI_COST', 'true');

    expect(() => assertHarborLiveEvaluation({
      userId: 'harbor-graphrag-eval-run-1',
      runId: 'run-1',
      confirmLiveAiCost: true,
    })).not.toThrow();

    expect(() => assertHarborLiveEvaluation({
      userId: 'demo-user',
      runId: 'run-1',
      confirmLiveAiCost: true,
    })).toThrow(/dedicated|exactly/i);
  });

  it('checks only pilot-brief concepts at the pilot-brief checkpoint', () => {
    const project = createProjectFromInput({
      name: 'Evaluation project',
      goal: 'Launch a paid pilot by November 1.',
      deadline: '2026-11-01',
    });
    project.nodes.push(
      { id: 'n-budget', type: 'CONSTRAINT', text: 'The maximum pilot budget is $50,000.', status: 'OPEN', confidence: 1, impact: 0.8, source_refs: [], created_by: 'agent', created_at: project.created_at, updated_at: project.created_at },
      { id: 'n-target', type: 'CONSTRAINT', text: 'The pilot must demonstrate a 12% reduction in energy cost.', status: 'OPEN', confidence: 1, impact: 0.8, source_refs: [], created_by: 'agent', created_at: project.created_at, updated_at: project.created_at },
      { id: 'n-margin', type: 'CONSTRAINT', text: 'The pilot must maintain at least a 40% gross margin.', status: 'OPEN', confidence: 1, impact: 0.8, source_refs: [], created_by: 'agent', created_at: project.created_at, updated_at: project.created_at },
      { id: 'n-scope', type: 'DECISION', text: 'Choose the technical scope: nightly CSV or real-time integration.', status: 'OPEN', confidence: 1, impact: 0.9, source_refs: [], created_by: 'agent', created_at: project.created_at, updated_at: project.created_at },
      { id: 'n-csv', type: 'EVIDENCE', text: 'Nightly CSV exports are acceptable and take 70 to 90 engineering hours.', status: 'OPEN', confidence: 0.9, impact: 0.7, source_refs: [], created_by: 'agent', created_at: project.created_at, updated_at: project.created_at },
      { id: 'n-realtime', type: 'EVIDENCE', text: 'A real-time integration would take four to six weeks and be customer-specific engineering.', status: 'OPEN', confidence: 0.9, impact: 0.7, source_refs: [], created_by: 'agent', created_at: project.created_at, updated_at: project.created_at },
    );

    const checks = evaluateHarborSemanticChecks(project, 'pilot_brief');
    expect(checks.filter((item) => item.status === 'pass').map((item) => item.id)).toEqual(expect.arrayContaining([
      'pilot_brief-concept-pilot-budget',
      'pilot_brief-concept-energy-target',
      'pilot_brief-concept-margin-target',
    ]));
    expect(checks.some((item) => item.id.includes('scope') || item.id.includes('engineering'))).toBe(false);
  });

  it('does not penalize a pilot-only project for missing technical-scope concepts', () => {
    const project = createProjectFromInput({
      name: 'Pilot-only project',
      goal: 'Launch a paid pilot by November 1.',
      deadline: '2026-11-01',
    });
    const checks = evaluateHarborSemanticChecks(project, 'pilot_brief');
    expect(checks.every((item) => !item.id.includes('scope') && !item.id.includes('engineering'))).toBe(true);
    expect(evaluateHarborSemanticChecks(project, 'technical_scope')).toHaveLength(5);
  });

  it('detects represented Today nodes by graph provenance, not display IDs', () => {
    const question = {
      id: 'question_deletion',
      question: 'Can the pilot data be deleted within 30 days?',
      reason: 'Retention matters.',
      provenance: 'Graph node: deletion-unknown',
      sourceNodeIds: ['deletion-unknown'],
    } satisfies TodayQuestion;

    expect(questionRepresentsNode(question, 'deletion-unknown')).toBe(true);
    expect(duplicatedRepresentedNodeIds([question], [], ['deletion-unknown', 'confirmation-action']))
      .toEqual(['deletion-unknown']);
    expect(duplicatedRepresentedNodeIds([], [], ['deletion-unknown', 'confirmation-action'])).toEqual([]);
  });

  it('declares route expectations in scenario metadata and counts graph retrieval without paths', () => {
    expect(HARBOR_ASK_SCENARIOS.find((scenario) => scenario.id === 'pilot-budget')).toMatchObject({
      expectedRoute: 'internal_context',
      expectedReasoningMode: 'factual',
    });
    const turn = {
      id: 'turn-1',
      scenarioId: 'graph',
      phase: 'middle',
      query: 'What changes?',
      expectedRoute: 'graph_reasoning',
      selectedRoute: 'graph_reasoning',
      seedNodeIds: ['n1'],
      expandedNodeIds: [],
      relationshipIds: [],
      paths: [],
      retrievedEvidence: [],
      selectedNodes: [],
      citedSources: [],
      sourceIds: [],
      answer: 'An answer.',
      proposals: [],
      checks: [],
    } satisfies HarborAskEvaluationTurn;
    expect(graphRagPipelineStatus([turn])).toBe('used');
    expect(harborAskRouteCheckStatus({ expectedRoute: 'graph_reasoning' }, 'internal_context')).toBe('fail');
    expect(harborAskRouteCheckStatus({ expectedRoute: 'internal_context' }, 'graph_reasoning')).toBe('warn');
  });

  it('passes retrieved evidence and focus context to the evaluator input', () => {
    const project = createProjectFromInput({ name: 'Evaluator input', goal: 'Test the report.' });
    const turn = {
      id: 'turn-focus',
      scenarioId: 'focus',
      phase: 'middle',
      query: 'What should I focus on?',
      expectedRoute: 'graph_reasoning',
      seedNodeIds: [],
      expandedNodeIds: [],
      relationshipIds: [],
      paths: [],
      sourceIds: [],
      retrievedEvidence: [{
        sourceId: 'source-1',
        title: 'Security notes',
        excerpt: 'The security review is still pending.',
        supports: ['security approval'],
      }],
      selectedNodes: [],
      citedSources: [],
      answer: 'Address the security review next.',
      proposals: [],
      focusContext: { targetNodeId: 'security', targetText: 'Security approval' },
      checks: [],
    } satisfies HarborAskEvaluationTurn;
    const encoded = buildHarborEvaluatorInput({
      timeline: [],
      askTurns: [turn],
      focusEvaluations: [],
      deterministicChecks: [],
    }, project);
    expect(JSON.parse(encoded)).toMatchObject({
      askTurns: [{
        retrievedEvidence: [{ sourceId: 'source-1', excerpt: 'The security review is still pending.' }],
        focusContext: { targetNodeId: 'security' },
      }],
    });
  });
});
