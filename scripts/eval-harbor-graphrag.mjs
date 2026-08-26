import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

if (process.env.GAPSWISE_DEMO_MODE !== 'false') {
  throw new Error('Set GAPSWISE_DEMO_MODE=false before running the Harbor GraphRAG evaluation.');
}
if (process.env.GAP_AGENT_MODE !== 'live') {
  throw new Error('Set GAP_AGENT_MODE=live before running the Harbor GraphRAG evaluation.');
}
if (process.env.CONFIRM_LIVE_AI_COST !== 'true') {
  throw new Error('Set CONFIRM_LIVE_AI_COST=true before running the Harbor GraphRAG evaluation.');
}

const runId = process.env.HARBOR_GRAPHRAG_RUN_ID || new Date().toISOString()
  .replace(/[^0-9A-Za-z_-]/g, '')
  .slice(-24);
const userId = `harbor-graphrag-eval-${runId}`;
const baseUrl = (process.env.EVAL_BASE_URL || `http://localhost:${process.env.PORT || '3000'}`).replace(/\/$/, '');
const response = await fetch(`${baseUrl}/api/evals/harbor-graphrag`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId, runId, confirmLiveAiCost: true }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(body.error || `Harbor evaluation endpoint returned ${response.status}.`);
}

const outputDir = path.resolve('artifacts', 'harbor-graphrag', runId);
await mkdir(outputDir, { recursive: true });
const report = body;

function writeJson(name, value) {
  return writeFile(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function statusIcon(status) {
  return status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL';
}

function compactNode(node) {
  return `${node.type} · ${node.status} · ${node.text}`;
}

function compactText(value, limit = 700) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function markdownReport(value) {
  const checks = value.deterministicChecks || [];
  const passed = checks.filter((item) => item.status === 'pass');
  const failed = checks.filter((item) => item.status === 'fail');
  const warnings = checks.filter((item) => item.status === 'warn');
  const models = Object.entries(value.models || {}).map(([role, model]) => `- ${role}: ${model}`).join('\n');
  const pipeline = Object.entries(value.pipeline || {}).map(([name, status]) => `- ${name}: ${status}`).join('\n');
  const timeline = (value.timeline || []).map((item) =>
    `| ${item.step} | ${item.label} | ${item.nodeCount} | ${item.edgeCount} | ${item.saveCompleted ? 'yes' : 'no'} | ${item.reloadedProjectId === item.projectId ? 'yes' : 'no'} |`
  ).join('\n');
  const asks = (value.askTurns || []).map((turn) => [
    `### ${turn.scenarioId || turn.phase}: ${turn.query}`,
    `- Phase: ${turn.phase}`,
    `- Route: expected ${turn.expectedRoute || 'not recorded'}; actual ${turn.selectedRoute || 'not recorded'}`,
    `- Reasoning mode: expected ${turn.expectedReasoningMode || 'not specified'}; actual ${turn.reasoningMode || 'none'}`,
    `- Seeds: ${turn.seedNodeIds.join(', ') || 'none'}`,
    `- Expanded: ${turn.expandedNodeIds.join(', ') || 'none'}`,
    `- Relationships: ${turn.relationshipIds.join(', ') || 'none'}`,
    `- Paths: ${(turn.paths || []).map((path) => `${path.nodeIds.join(' → ')} [${path.edgeIds.join(', ')}]`).join('; ') || 'none'}`,
    `- Retrieved evidence: ${(turn.retrievedEvidence || []).map((source) => `${source.title} (${source.sourceId}) — ${compactText(source.excerpt)}${source.supports?.length ? `; supports: ${source.supports.slice(0, 3).map((support) => compactText(support, 180)).join(' · ')}` : ''}`).join(' | ') || 'none'}`,
    `- Cited sources: ${(turn.citedSources || []).map((source) => source.url ? `${source.title} (${source.url})` : source.title).join(', ') || 'none'}`,
    `- Answer: ${compactText(turn.answer, 2200)}`,
    `- Focus context: ${turn.focusContext ? JSON.stringify(turn.focusContext) : 'none'}`,
    `- Checks: ${(turn.checks || []).map((item) => `${statusIcon(item.status)} ${item.details}`).join(' | ')}`,
  ].join('\n')).join('\n\n');
  const focuses = (value.focusEvaluations || []).map((item) => [
    `### ${item.phase}`,
    `- Focus: ${item.targetNode ? compactNode(item.targetNode) : 'none'}`,
    `- Execution: ${item.executionNode ? compactNode(item.executionNode) : 'none'}`,
    `- Represented: ${(item.representedNodes || []).map(compactNode).join(' | ') || 'none'}`,
    `- CTA: ${item.today?.primaryAction || 'none'}`,
    `- Secondary questions: ${(item.today?.visibleOpenQuestions || []).map((question) => `${question.id} — ${question.text} [${question.sourceNodeIds.join(', ')}]`).join(' | ') || 'none'}`,
    `- Secondary decisions: ${(item.today?.visibleDecisions || []).map((decision) => `${decision.id} — ${decision.text}`).join(' | ') || 'none'}`,
    `- Duplicated represented node IDs: ${(item.today?.duplicatedRepresentedNodeIds || []).join(', ') || 'none'}`,
    `- Checks: ${(item.checks || []).map((check) => `${statusIcon(check.status)} ${check.details}`).join(' | ')}`,
  ].join('\n')).join('\n\n');
  const ai = value.aiEvaluation
    ? [
        `Overall score: ${value.aiEvaluation.overallScore}`,
        `Summary: ${value.aiEvaluation.summary}`,
        `Strengths: ${(value.aiEvaluation.strengths || []).join(' | ') || 'none'}`,
        `Failures: ${(value.aiEvaluation.failures || []).map((failure) => `${failure.severity} ${failure.area}: ${failure.evidence} → ${failure.recommendation}`).join(' | ') || 'none'}`,
      ].join('\n')
    : 'AI evaluator did not return a result.';
  return `# Harbor Hotels GraphRAG E2E Evaluation

Run ID: ${value.runId}
Date: ${value.completedAt}
Project ID: ${value.projectId || 'none'}
Duration: ${value.durationMs} ms
Overall result: **${value.status}**

## Models used
${models || 'none'}

## Pipeline execution
${pipeline || 'none'}

## Timeline
| Step | Source/label | Nodes | Edges | Save | Reload |
|---:|---|---:|---:|---|---|
${timeline || '| - | none | - | - | - | - |'}

## Final project state
${value.finalProject ? `- Nodes: ${value.finalProject.nodes.length}\n- Edges: ${value.finalProject.edges.length}\n- Sources: ${value.finalProject.sources.length}\n- Open questions: ${value.finalProject.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN').map(compactNode).join(' | ') || 'none'}\n- Open decisions: ${value.finalProject.nodes.filter((node) => node.type === 'DECISION' && node.status === 'OPEN').map(compactNode).join(' | ') || 'none'}\n- Resolved decisions: ${value.finalProject.nodes.filter((node) => node.type === 'DECISION' && node.status === 'RESOLVED').map(compactNode).join(' | ') || 'none'}\n- Actions: ${value.finalProject.nodes.filter((node) => node.type === 'NEXT_ACTION' && node.status === 'OPEN').map(compactNode).join(' | ') || 'none'}` : 'No final project was returned.'}

## Ask evaluations
${asks || 'none'}

## Focus and Today
${focuses || 'none'}

## Deterministic checks
- PASS: ${passed.length}
- WARN: ${warnings.length}
- FAIL: ${failed.length}
${checks.map((item) => `- ${statusIcon(item.status)} [${item.phase}/${item.area}] ${item.details}`).join('\n')}

## AI evaluation
${ai}
`;
}

await Promise.all([
  writeJson('report.json', report),
  writeJson('final-project.json', report.finalProject),
  writeJson('ask-turns.json', report.askTurns || []),
  writeJson('timeline.json', report.timeline || []),
  writeFile(path.join(outputDir, 'report.md'), markdownReport(report), 'utf8'),
]);

console.log(`Harbor GraphRAG evaluation: ${report.status}`);
console.log(`Run ID: ${runId}`);
console.log(`Project ID: ${report.projectId || 'none'}`);
console.log(`Artifacts: ${outputDir}`);
