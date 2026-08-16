import type { ClarityNode, Project, UserMemoryProfile } from '@/types/clarity';
import { calculateClarityScore, selectTopGap } from '@/lib/prioritization';
import { rankSources } from '@/lib/retrieval/relevance';

export interface IdontKnowContextFinding {
  sourceId: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface IdontKnowContextPreview {
  questionNodeId?: string;
  question: string;
  findings: IdontKnowContextFinding[];
  proposedChange?: string;
}

export function previewIdontKnowContext(project: Project): IdontKnowContextPreview {
  const activeGap = project.active_question;
  if (!activeGap) return { question: '', findings: [] };

  const findings = rankSources(
    activeGap.question,
    project.sources.filter((source) => !source.discarded_at && source.processing_status !== 'failed'),
    4,
  )
    .filter((finding) => finding.score >= 0.3)
    .map((finding) => ({
      sourceId: finding.source_id,
      title: finding.filename,
      excerpt: finding.excerpt.slice(0, 240),
      score: finding.score,
    }));

  return {
    questionNodeId: activeGap.node_id,
    question: activeGap.question,
    findings,
    ...(findings.length > 0 ? {
      proposedChange: `Add one Evidence node using ${findings.length} relevant source${findings.length === 1 ? '' : 's'} and link it to this question. This adds context without treating the question as answered.`,
    } : {}),
  };
}

export async function processIdontKnowStrategy(
  project: Project,
  strategy: 'rag' | 'experiment' | 'assumption' | 'defer',
  profile: UserMemoryProfile
): Promise<{ updatedProject: Project; strategyMessage: string; didChange: boolean; changedNodeId?: string }> {
  const updated: Project = JSON.parse(JSON.stringify(project));
  const activeGap = updated.active_question;
  if (!activeGap) return { updatedProject: updated, strategyMessage: 'This question is no longer active. Refresh Today and choose another question.', didChange: false };

  const targetNode = updated.nodes.find((node) => node.id === activeGap.node_id);
  if (!targetNode) return { updatedProject: updated, strategyMessage: 'This question is no longer available in the project.', didChange: false };

  const now = new Date().toISOString();
  const idSuffix = `${Date.now()}_${updated.nodes.length}`;
  let message = '';
  let didChange = false;
  let changedNodeId: string | undefined;

  if (strategy === 'rag') {
    const preview = previewIdontKnowContext(updated);
    if (preview.findings.length > 0) {
      const sourceIds = preview.findings.map((finding) => finding.sourceId);
      const evidenceSummary = preview.findings
        .map((finding) => `${finding.title}: ${finding.excerpt}`)
        .join(' ')
        .slice(0, 520);
      const evidenceConfidence = Math.max(...preview.findings.map((finding) => finding.score), 0.65);
      const evidenceNode: ClarityNode = {
        id: `ev_${idSuffix}`,
        type: 'EVIDENCE',
        text: `Context search evidence: ${evidenceSummary}`,
        status: 'RESOLVED',
        confidence: evidenceConfidence,
        impact: targetNode.impact,
        source_refs: sourceIds,
        created_by: 'rag',
        created_at: now,
        updated_at: now,
        x: targetNode.x ? targetNode.x - 40 : 200,
        y: targetNode.y ? targetNode.y + 60 : 420,
      };
      updated.nodes.push(evidenceNode);
      updated.sources
        .filter((source) => sourceIds.includes(source.id))
        .forEach((source) => {
          if (!source.derived_node_ids.includes(evidenceNode.id)) source.derived_node_ids.push(evidenceNode.id);
        });
      updated.edges.push({
        id: `edge_${idSuffix}`,
        source: evidenceNode.id,
        target: targetNode.id,
        type: 'informs',
        confidence: evidenceNode.confidence,
      });
      targetNode.confidence = Math.max(targetNode.confidence, Math.min(0.75, 0.45 + evidenceConfidence * 0.3));
      targetNode.updated_at = now;
      didChange = true;
      changedNodeId = evidenceNode.id;
      message = `Added one Evidence node from ${preview.findings.length} relevant source${preview.findings.length === 1 ? '' : 's'} and linked it to the question. The question remains open for your judgment.`;
    } else {
      message = 'Searched the uploaded context, but found no relevant evidence for this question. Choose another option to create a next step.';
    }
  } else if (strategy === 'experiment') {
    const question = activeGap.question.replace(/[?]+$/, '');
    const experimentNode: ClarityNode = {
      id: `exp_${idSuffix}`,
      type: 'EXPERIMENT',
      text: `Minimal experiment: get one concrete answer to “${question}” through a targeted conversation or quick evidence check.`,
      status: 'OPEN',
      confidence: 0.8,
      impact: targetNode.impact,
      source_refs: [],
      why_it_matters: [`This gathers evidence needed to answer “${question}”.`],
      created_by: 'agent',
      created_at: now,
      updated_at: now,
      x: targetNode.x ? targetNode.x + 60 : 450,
      y: targetNode.y ? targetNode.y + 80 : 420,
    };
    updated.nodes.push(experimentNode);
    updated.edges.push({ id: `edge_${idSuffix}`, source: experimentNode.id, target: targetNode.id, type: 'informs', confidence: 0.8 });
    didChange = true;
    message = `Created a small experiment for “${question}” and linked it to the unresolved question.`;
  } else if (strategy === 'assumption') {
    const question = activeGap.question.replace(/[?]+$/, '');
    const assumptionNode: ClarityNode = {
      id: `assumption_${idSuffix}`,
      type: 'ASSUMPTION',
      text: `Temporary working assumption: proceed without a confirmed answer to “${question}”.`,
      status: 'RESOLVED',
      confidence: 0.5,
      impact: targetNode.impact,
      source_refs: [...targetNode.source_refs],
      why_it_matters: ['This records that work is continuing under explicit uncertainty.'],
      created_by: 'user',
      created_at: now,
      updated_at: now,
      x: targetNode.x ? targetNode.x + 50 : 430,
      y: targetNode.y ? targetNode.y + 60 : 420,
    };
    updated.nodes.push(assumptionNode);
    updated.edges.push({ id: `edge_${idSuffix}`, source: assumptionNode.id, target: targetNode.id, type: 'informs', confidence: 0.5 });
    targetNode.status = 'DEFERRED';
    targetNode.updated_at = now;
    didChange = true;
    message = 'Recorded a 50% confidence working assumption, deferred the unanswered question, and moved attention to the next gap.';
  } else {
    targetNode.status = 'DEFERRED';
    targetNode.updated_at = now;
    didChange = true;
    message = 'Gap deferred — moving to the next highest priority uncertainty.';
  }

  if (didChange) {
    updated.clarity_score = calculateClarityScore(updated);
    updated.active_question = selectTopGap(updated, profile);
    updated.updated_at = now;
  }
  return { updatedProject: updated, strategyMessage: message, didChange, changedNodeId };
}
