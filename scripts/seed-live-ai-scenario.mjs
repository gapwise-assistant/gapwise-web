import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const fixtureDir = path.join(projectDir, 'docs', 'test-data', 'clinicflow');
const baseUrl = (process.env.GAPWISE_LOCAL_URL || 'http://localhost:3000').replace(/\/$/, '');
const userId = 'demo-user';

const sources = [
  '01-pilot-brief.md',
  '02-clinical-operations-notes.md',
  '03-vendor-security-and-commercial-review.md',
  '04-steering-update-and-decision-log.md',
];

function fail(message) {
  console.error(`Scenario setup failed: ${message}`);
  process.exit(1);
}

async function jsonRequest(pathname, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    fail(`${pathname} returned a non-JSON response (${response.status}).`);
  }
  if (!response.ok) fail(body?.error || `${pathname} returned status ${response.status}.`);
  return body;
}

if (process.env.CONFIRM_LIVE_AI_COST !== 'true') {
  fail('This scenario makes bounded live Gemini calls. Rerun with CONFIRM_LIVE_AI_COST=true.');
}

try {
  await jsonRequest('/api/runtime');
} catch {
  fail(`Gapwise is not ready at ${baseUrl}. Start it with "npm run dev:ai" first.`);
}

console.log('Creating ClinicFlow — Outpatient Intake Pilot...');
const created = await jsonRequest('/api/projects', {
  method: 'POST',
  body: JSON.stringify({
    userId,
    name: 'ClinicFlow — Outpatient Intake Pilot',
    goal: 'Decide whether and how to launch a six-week outpatient intake pilot without increasing patient risk or staff workload.',
    description: 'A deliberately messy decision dossier with conflicting clinical authority, reliability, consent, capacity, budget, and deadline evidence.',
    deadline: '2026-09-04',
  }),
});

const projectId = created.project.id;
const runId = Date.now();

for (const [index, filename] of sources.entries()) {
  const content = await readFile(path.join(fixtureDir, filename), 'utf8');
  console.log(`[${index + 1}/${sources.length}] Ingesting ${filename} through live Gemini...`);
  const result = await jsonRequest('/api/context/ingest', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      projectId,
      sourceId: `clinicflow_live_${runId}_${index + 1}`,
      filename,
      content,
      type: 'text',
      origin: 'user',
    }),
  });
  const question = result.project?.active_question;
  console.log(JSON.stringify({
    modelUsed: result.modelUsed || null,
    extractedNodes: result.analysis?.nodes?.length ?? 0,
    extractedRelationships: result.analysis?.relationships?.length ?? 0,
    selectedGapId: question?.node_id || null,
    guidanceSource: question?.guidance?.generatedBy || null,
    focus: question?.guidance?.focus || null,
  }, null, 2));
}

console.log('');
console.log('Scenario ready.');
console.log(`Open ${baseUrl} and select "ClinicFlow — Outpatient Intake Pilot".`);
console.log('Continue with docs/full-live-ai-scenario.md.');
console.log('Expected proof: Recommended Focus is labeled "Gap Agent" and Decision Map activity contains a completed live run.');

