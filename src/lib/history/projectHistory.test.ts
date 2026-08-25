import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { ingestContextSource } from '@/lib/context/ingestion';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { confirmDecision } from '@/lib/decisions/workspace';
import { projectToCollections, collectionsToProject } from '@/lib/storage/projectMapper';
import {
  appendDecisionResolvedHistory,
  appendContextAddedHistory,
  appendGoalChangedHistory,
  attachHistoryFocus,
  historyCurrentFocus,
} from '@/lib/history/projectHistory';

describe('project history', () => {
  it('records one compact event for meaningful context ingestion', async () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run a useful workshop.' });
    const updated = await ingestContextSource(project, {
      sourceId: 'source_workshop',
      filename: 'planning note',
      type: 'note',
      content: 'The workshop needs a venue and the first session is not scheduled yet.',
      derivedNodes: [
        {
          id: 'node_venue',
          type: 'DECISION',
          text: 'Choose the workshop venue.',
          confidence: 0.9,
        },
        {
          id: 'node_schedule',
          type: 'UNKNOWN',
          text: 'When is the first session scheduled?',
          confidence: 0.9,
        },
      ],
    }, DEFAULT_USER_PROFILE);

    expect(updated.historyEvents).toHaveLength(1);
    expect(updated.historyEvents?.[0]).toMatchObject({
      type: 'context_added',
      sourceId: 'source_workshop',
      sourceNodeIds: ['node_venue', 'node_schedule'],
    });
    expect(updated.historyEvents?.[0].changes).toHaveLength(2);
  });

  it('does not create timeline noise when repeated context adds no semantic change', async () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run a useful workshop.' });
    const input = {
      sourceId: 'source_repeat',
      filename: 'planning note',
      type: 'note' as const,
      content: 'The workshop needs a venue.',
      derivedNodes: [{ id: 'node_venue', type: 'DECISION' as const, text: 'Choose the workshop venue.', confidence: 0.9 }],
    };
    const first = await ingestContextSource(project, input, DEFAULT_USER_PROFILE);
    const repeated = await ingestContextSource(first, {
      ...input,
      sourceId: 'source_repeat_2',
    }, DEFAULT_USER_PROFILE);

    expect(repeated.historyEvents).toHaveLength(1);
  });

  it('records a decision outcome and downstream graph changes', () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run a useful workshop.' });
    project.nodes.push({
      id: 'decision_venue',
      type: 'DECISION',
      text: 'Choose the venue.',
      status: 'OPEN',
      confidence: 0.8,
      impact: 0.9,
      source_refs: [],
      created_by: 'agent',
      created_at: project.created_at,
      updated_at: project.updated_at,
    });

    const updated = confirmDecision(project, {
      decisionNodeId: 'decision_venue',
      customDecision: 'Use the community hall.',
    });

    expect(updated.historyEvents).toHaveLength(1);
    expect(updated.historyEvents?.[0]).toMatchObject({
      type: 'decision_resolved',
      summary: 'Use the community hall.',
    });
    expect(updated.historyEvents?.[0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'resolved', nodeId: 'decision_venue' }),
    ]));
    expect(updated.nodes.find((node) => node.id === 'decision_venue')?.status).toBe('RESOLVED');
  });

  it('records a material goal change and round-trips history through storage', () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run a useful workshop.' });
    const changed = appendGoalChangedHistory(project, {
      ...project,
      goal: 'Validate demand before committing to a recurring workshop.',
      updated_at: '2026-08-23T12:00:00.000Z',
    });
    const loaded = collectionsToProject(projectToCollections('history-user', changed), changed.id);

    expect(changed.historyEvents).toHaveLength(1);
    expect(loaded?.historyEvents).toEqual(changed.historyEvents);
  });

  it('keeps the original node text and status after a later mutation', async () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run a useful workshop.' });
    const first = await ingestContextSource(project, {
      sourceId: 'source_location_question',
      filename: 'initial plan',
      type: 'note',
      content: 'The launch location is still undecided.',
      derivedNodes: [{
        id: 'decision_location',
        type: 'DECISION',
        text: 'Choose the launch location.',
        status: 'OPEN',
        confidence: 0.9,
      }],
    }, DEFAULT_USER_PROFILE);

    const second = await ingestContextSource(first, {
      sourceId: 'source_location_answer',
      filename: 'location decision',
      type: 'note',
      content: 'The launch location is now selected.',
      derivedNodes: [{
        id: 'decision_location',
        type: 'DECISION',
        text: 'Use the community hall for the first event.',
        status: 'RESOLVED',
        confidence: 1,
      }],
    }, DEFAULT_USER_PROFILE);

    const originalChange = second.historyEvents?.[0].changes?.find((change) => change.nodeId === 'decision_location');
    expect(originalChange?.snapshot).toMatchObject({
      nodeId: 'decision_location',
      text: 'Choose the launch location.',
      type: 'DECISION',
      status: 'OPEN',
    });
    expect(second.historyEvents?.[0].changes?.[0].text).toBe('Choose the launch location.');
    expect(second.historyEvents?.[1].changes?.[0].snapshot?.text).toBe('Use the community hall for the first event.');
  });

  it('reports existing downstream nodes as affected without repeating learned nodes', async () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run a useful workshop.' });
    const first = await ingestContextSource(project, {
      sourceId: 'source_decision',
      filename: 'planning note',
      type: 'note',
      content: 'The venue decision is open.',
      derivedNodes: [{
        id: 'decision_venue',
        type: 'DECISION',
        text: 'Choose the venue.',
        status: 'OPEN',
        confidence: 0.9,
      }],
    }, DEFAULT_USER_PROFILE);
    const second = await ingestContextSource(first, {
      sourceId: 'source_survey',
      filename: 'customer survey',
      type: 'note',
      content: 'Survey evidence informs the venue decision.',
      derivedNodes: [{
        id: 'evidence_convenience',
        type: 'EVIDENCE',
        text: 'Most attendees prefer a central venue.',
        confidence: 0.9,
        relatedNodeIds: ['decision_venue'],
      }],
      relationships: [{
        sourceRef: 'new:0',
        targetRef: 'decision_venue',
        type: 'informs',
        confidence: 0.9,
      }],
    }, DEFAULT_USER_PROFILE);

    const event = second.historyEvents?.[1];
    expect(event?.changes?.map((change) => change.nodeId)).toEqual(['evidence_convenience']);
    expect(event?.affectedNodes).toEqual([expect.objectContaining({
      nodeId: 'decision_venue',
      text: 'Choose the venue.',
      type: 'DECISION',
      status: 'OPEN',
    })]);
    expect(event?.affectedNodes?.some((node) => node.nodeId === 'evidence_convenience')).toBe(false);
  });

  it('omits affected items when a new node has no meaningful downstream impact', async () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run a useful workshop.' });
    const updated = await ingestContextSource(project, {
      sourceId: 'source_fact',
      filename: 'standalone fact',
      type: 'note',
      content: 'The folding tables are stored in the supply room.',
      derivedNodes: [{
        id: 'known_tables',
        type: 'KNOWN',
        text: 'The folding tables are stored in the supply room.',
        confidence: 0.9,
      }],
    }, DEFAULT_USER_PROFILE);

    expect(updated.historyEvents?.[0].affectedNodes).toBeUndefined();
    expect(updated.historyEvents?.[0].affectedNodeIds).toBeUndefined();
  });

  it('captures focus transitions without treating equivalent wording as a new focus', () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run a useful workshop.' });
    project.nodes.push(
      {
        id: 'gap_venue',
        type: 'UNKNOWN',
        text: 'Which venue is available?',
        status: 'OPEN',
        confidence: 0.7,
        impact: 0.8,
        source_refs: ['source_focus'],
        created_by: 'agent',
        created_at: project.created_at,
        updated_at: project.updated_at,
      },
      {
        id: 'gap_schedule',
        type: 'UNKNOWN',
        text: 'What date is available?',
        status: 'OPEN',
        confidence: 0.7,
        impact: 0.8,
        source_refs: ['source_focus'],
        created_by: 'agent',
        created_at: project.created_at,
        updated_at: project.updated_at,
      },
    );
    project.active_question = {
      node_id: 'gap_venue',
      question: 'Which venue is available?',
      uncertainty: 0.3,
      downstream_impact: 0.8,
      dependency_count: 1,
      urgency: 0.5,
      answerability: 0.5,
      user_relevance: 0.7,
      interruption_cost: 0.1,
      priority: 0.8,
      reasons: [],
      blocked_decision_ids: [],
    };
    const after = JSON.parse(JSON.stringify(project)) as typeof project;
    after.active_question = {
      ...project.active_question,
      node_id: 'gap_schedule',
      question: 'What date is available?',
    };
    after.nodes.push({
      id: 'known_focus',
      type: 'KNOWN',
      text: 'The workshop date is being checked next.',
      status: 'RESOLVED',
      confidence: 0.9,
      impact: 0.5,
      source_refs: ['source_focus'],
      created_by: 'agent',
      created_at: '2026-08-23T12:00:00.000Z',
      updated_at: '2026-08-23T12:00:00.000Z',
    });
    after.sources.push({
      id: 'source_focus',
      filename: 'focus context',
      type: 'note',
      content: 'The date is now the next thing to clarify.',
      extracted_at: '2026-08-23T12:00:00.000Z',
      derived_node_ids: ['gap_schedule'],
    });
    after.nodes[after.nodes.length - 1].source_refs = ['source_focus'];

    const changed = appendContextAddedHistory(project, after, {
      sourceId: 'source_focus',
      filename: 'focus context',
      createdAt: '2026-08-23T12:00:00.000Z',
    });
    expect(changed.historyEvents?.[0].focusBefore?.actionNodeId).toBe('gap_venue');
    expect(changed.historyEvents?.[0].focusAfter?.actionNodeId).toBe('gap_schedule');

    const equivalent = JSON.parse(JSON.stringify(project)) as typeof project;
    equivalent.active_question = { ...project.active_question, question: 'Which venue is available right now?' };
    const same = appendContextAddedHistory(project, equivalent, {
      sourceId: 'source_focus_equivalent',
      filename: 'same focus',
      createdAt: '2026-08-23T12:01:00.000Z',
    });
    expect(same.historyEvents ?? []).toHaveLength(0);
    expect(historyCurrentFocus(changed, {
      title: 'What date is available?',
      actionNodeId: 'gap_schedule',
    })?.actionNodeId).toBe('gap_schedule');
  });

  it('uses singular and plural node-type labels in context summaries', async () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run a useful workshop.' });
    const updated = await ingestContextSource(project, {
      sourceId: 'source_summary',
      filename: 'summary note',
      type: 'note',
      content: 'Several project facts were recorded.',
      derivedNodes: [
        { id: 'fact_one', type: 'KNOWN', text: 'The room has tables.', confidence: 0.9 },
        { id: 'evidence_one', type: 'EVIDENCE', text: 'The room is available.', confidence: 0.9 },
        { id: 'preference_one', type: 'PREFERENCE', text: 'Prefer a quiet room.', confidence: 0.9 },
        { id: 'constraint_one', type: 'CONSTRAINT', text: 'The room must be accessible.', confidence: 0.9 },
      ],
    }, DEFAULT_USER_PROFILE);

    expect(updated.historyEvents?.[0].summary).toBe('4 things learned\n1 fact · 1 evidence · 1 preference · 1 constraint');
  });

  it('records real decision consequences and excludes unrelated nodes', () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run a useful workshop.' });
    const now = project.updated_at;
    project.nodes.push(
      {
        id: 'decision_venue',
        type: 'DECISION',
        text: 'Choose the venue.',
        status: 'OPEN',
        confidence: 0.8,
        impact: 0.9,
        source_refs: [],
        created_by: 'agent',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'action_satisfied',
        type: 'NEXT_ACTION',
        text: 'Select the workshop venue.',
        status: 'OPEN',
        confidence: 0.8,
        impact: 0.8,
        source_refs: [],
        created_by: 'agent',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'action_unblocked',
        type: 'NEXT_ACTION',
        text: 'Submit the venue paperwork.',
        status: 'OPEN',
        confidence: 0.8,
        impact: 0.7,
        source_refs: [],
        created_by: 'agent',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'unrelated_risk',
        type: 'RISK',
        text: 'The weather may change.',
        status: 'OPEN',
        confidence: 0.7,
        impact: 0.4,
        source_refs: [],
        created_by: 'agent',
        created_at: now,
        updated_at: now,
      },
    );
    project.edges.push(
      { id: 'edge_satisfies', source: 'action_satisfied', target: 'decision_venue', type: 'satisfies' },
      { id: 'edge_depends', source: 'action_unblocked', target: 'decision_venue', type: 'depends_on' },
    );

    const updated = confirmDecision(project, {
      decisionNodeId: 'decision_venue',
      customDecision: 'Use the community hall.',
    });
    const event = updated.historyEvents?.[0];

    expect(event?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'resolved', nodeId: 'decision_venue' }),
      expect.objectContaining({ kind: 'resolved', nodeId: 'action_satisfied' }),
      expect.objectContaining({ kind: 'unblocked', nodeId: 'action_unblocked' }),
    ]));
    expect(event?.changes?.some((change) => change.nodeId === 'unrelated_risk')).toBe(false);
    expect(event?.affectedNodes?.some((node) => node.nodeId === 'unrelated_risk') ?? false).toBe(false);

    const unrelatedMutation = JSON.parse(JSON.stringify(project)) as typeof project;
    const unrelatedDecision = unrelatedMutation.nodes.find((node) => node.id === 'decision_venue')!;
    unrelatedDecision.text = 'Use the community hall.';
    unrelatedDecision.status = 'RESOLVED';
    const unrelatedRisk = unrelatedMutation.nodes.find((node) => node.id === 'unrelated_risk')!;
    unrelatedRisk.status = 'RESOLVED';
    const isolatedEvent = appendDecisionResolvedHistory(project, unrelatedMutation, {
      nodeId: 'decision_venue',
      question: 'Choose the venue.',
      answer: 'Use the community hall.',
    }).historyEvents?.[0];
    expect(isolatedEvent?.changes?.some((change) => change.nodeId === 'unrelated_risk')).toBe(false);
  });

  it('attaches a shared focus transition without creating another event', () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run a useful workshop.' });
    project.historyEvents = [{
      id: 'decision_event',
      projectId: project.id,
      createdAt: '2026-08-24T12:00:00.000Z',
      type: 'decision_resolved',
      title: 'Decision made',
      summary: 'Use the community hall.',
    }];
    attachHistoryFocus(project, {
      eventType: 'decision_resolved',
      before: { title: 'Choose the venue.', actionNodeId: 'decision_venue' },
      after: { title: 'Submit the venue paperwork.', actionNodeId: 'action_paperwork' },
    });

    expect(project.historyEvents).toHaveLength(1);
    expect(project.historyEvents?.[0].focusBefore?.actionNodeId).toBe('decision_venue');
    expect(project.historyEvents?.[0].focusAfter?.actionNodeId).toBe('action_paperwork');

    attachHistoryFocus(project, {
      eventType: 'decision_resolved',
      before: { title: 'Choose the venue.', actionNodeId: 'decision_venue' },
      after: { title: 'Choose the venue, now.', actionNodeId: 'decision_venue' },
    });
    expect(project.historyEvents?.[0].focusBefore).toBeUndefined();
    expect(project.historyEvents?.[0].focusAfter).toBeUndefined();
  });
});
