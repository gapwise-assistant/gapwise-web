import process from 'node:process';

const checkpoint = process.argv[2] || 'early';
const allowed = new Set(['early', 'middle', 'late']);
const baseUrl = (process.env.GAPWISE_LOCAL_URL || 'http://localhost:3000').replace(/\/$/, '');
const userId = process.env.GAPWISE_DEFAULT_USER_ID || 'demo-user';

function fail(message) {
  console.error(`Harbor Hotels checkpoint failed: ${message}`);
  process.exit(1);
}

if (!allowed.has(checkpoint)) {
  fail(`checkpoint must be one of: ${Array.from(allowed).join(', ')}`);
}
if (process.env.CONFIRM_LIVE_AI_COST !== 'true') {
  fail('This checkpoint makes live Context Agent, Gap Agent, and Ask calls. Rerun with CONFIRM_LIVE_AI_COST=true.');
}

const response = await fetch(`${baseUrl}/api/projects/harbor-hotels/${checkpoint}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) fail(body.error || `HTTP ${response.status}`);

const project = body.project;
const openDecisions = project.nodes.filter((node) => node.type === 'DECISION' && node.status === 'OPEN');
const resolvedDecisions = project.nodes.filter((node) => node.type === 'DECISION' && node.status === 'RESOLVED');
const openUnknowns = project.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN');
const risks = project.nodes.filter((node) => node.type === 'RISK');

console.log(JSON.stringify({
  checkpoint,
  projectId: project.id,
  title: project.title,
  goal: project.goal,
  nodeCount: project.nodes.length,
  edgeCount: project.edges.length,
  openDecisions: openDecisions.map(({ id, text }) => ({ id, text })),
  resolvedDecisions: resolvedDecisions.map(({ id, text, decision_outcome }) => ({ id, text, decision_outcome })),
  openUnknowns: openUnknowns.map(({ id, text }) => ({ id, text })),
  risks: risks.map(({ id, text, status }) => ({ id, text, status })),
  recommendedFocus: project.active_question?.node_id || null,
  askActions: body.askActions || [],
}, null, 2));

console.log(`Open ${baseUrl} and select "${project.title}" to inspect Overview, Today, Gaps, Context, Decision Map, and Ask.`);
