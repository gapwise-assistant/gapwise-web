import { Project, ClarityNode, UserMemoryProfile } from '@/types/clarity';
import { selectTopGap, calculateClarityScore } from '@/lib/prioritization';
import { runGapswiseOrchestrator } from '@/lib/agents/orchestrator';
import { resolveGap } from '@/lib/tools/graphTools';
import { ingestContextSource } from '@/lib/context/ingestion';

export async function processUserAnswer(
  project: Project,
  questionNodeId: string,
  answerText: string,
  profile: UserMemoryProfile
): Promise<Project> {
  const updated = resolveGap(project, questionNodeId, answerText, profile);

  if (process.env.NODE_ENV !== 'production') {
    const turn = runGapswiseOrchestrator({
      userId: 'client-session',
      input: answerText,
      project: updated,
      profile,
      applyGraphUpdates: false,
    });
    console.info('[Gapswise agent trace]', turn.trace);
  }

  return updated;
}

export async function processIdontKnowStrategy(
  project: Project,
  strategy: 'rag' | 'experiment' | 'assumption' | 'defer',
  profile: UserMemoryProfile
): Promise<{ updatedProject: Project; strategyMessage: string }> {
  const updated: Project = JSON.parse(JSON.stringify(project));
  const activeGap = updated.active_question;
  if (!activeGap) return { updatedProject: updated, strategyMessage: 'No active gap.' };

  const targetNode = updated.nodes.find((n) => n.id === activeGap.node_id);
  let message = '';

  if (strategy === 'rag') {
    const matchingSource = updated.sources.find(
      (s) =>
        s.content.toLowerCase().includes('collaborative') ||
        s.content.toLowerCase().includes('hackathon') ||
        s.content.toLowerCase().includes('target')
    );
    if (matchingSource && targetNode) {
      targetNode.status = 'RESOLVED';
      targetNode.confidence = 0.88;
      const evidenceNode: ClarityNode = {
        id: `ev_${Date.now()}`,
        type: 'EVIDENCE',
        text: `RAG Evidence from "${matchingSource.filename}": ${matchingSource.content.slice(0, 100)}`,
        status: 'RESOLVED',
        confidence: 0.95,
        impact: 0.8,
        source_refs: [matchingSource.id],
        created_by: 'rag',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        x: targetNode.x ? targetNode.x - 40 : 200,
        y: targetNode.y ? targetNode.y + 60 : 420,
      };
      updated.nodes.push(evidenceNode);
      message = `Found evidence in "${matchingSource.filename}" — gap resolved via RAG retrieval.`;
    } else {
      message = 'Searched all uploaded sources — no conclusive answer found in context inbox.';
    }
  } else if (strategy === 'experiment') {
    const expNode: ClarityNode = {
      id: `exp_${Date.now()}`,
      type: 'EXPERIMENT',
      text: `Minimal Experiment: Run 3 user interviews to validate target persona hypothesis.`,
      status: 'OPEN',
      confidence: 0.8,
      impact: 0.85,
      source_refs: [],
      created_by: 'agent',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      x: targetNode?.x ? targetNode.x + 60 : 450,
      y: targetNode?.y ? targetNode.y + 80 : 420,
    };
    updated.nodes.push(expNode);
    message = 'Created EXPERIMENT node: "Run 3 target user interviews to resolve persona gap."';
  } else if (strategy === 'assumption') {
    if (targetNode) {
      targetNode.type = 'ASSUMPTION';
      targetNode.text = `Temporary Assumption: Target user is a hackathon builder creating complex agentic projects under deadline pressure.`;
      targetNode.confidence = 0.5;
      targetNode.updated_at = new Date().toISOString();
    }
    message = 'Converted gap to a temporary ASSUMPTION (50% confidence) — project execution unblocked.';
  } else if (strategy === 'defer') {
    if (targetNode) {
      targetNode.status = 'DEFERRED';
      targetNode.updated_at = new Date().toISOString();
    }
    message = 'Gap deferred — moving to the next highest priority uncertainty.';
  }

  updated.clarity_score = calculateClarityScore(updated);
  updated.active_question = selectTopGap(updated, profile);
  updated.updated_at = new Date().toISOString();
  return { updatedProject: updated, strategyMessage: message };
}

export async function addContextSource(
  project: Project,
  filename: string,
  content: string,
  type: 'text' | 'pdf' | 'image' | 'note' | 'voice',
  profile: UserMemoryProfile
): Promise<Project> {
  return ingestContextSource(project, { filename, content, type }, profile);
}
