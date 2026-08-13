import { Project } from '@/types/clarity';
import {
  agentNames,
  contextExtractionSchema,
  ContextExtraction,
  graphUpdateSchema,
  GraphUpdate,
  validateStructuredOutput,
} from '@/lib/agents/schemas';
import { activeContextSources } from '@/lib/context/sourceState';

export const contextAgentDefinition = {
  name: agentNames.context,
  model: 'gemini-2.5-flash-lite',
  description: 'Extracts facts, goals, constraints, commitments, and candidate unknowns from new context.',
  adkReady: true,
};

export function runContextAgent(input: string, project: Project): { extraction: ContextExtraction; graphUpdate: GraphUpdate } {
  const lower = input.toLowerCase();
  const sentences = input
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const facts = sentences.filter((sentence) => !sentence.endsWith('?'));
  const goals = sentences.filter((sentence) => /goal|want|need|trying to|ship|build/i.test(sentence));
  const constraints = sentences.filter((sentence) => /must|require|deadline|budget|constraint|cannot|can't|limited/i.test(sentence));
  const commitments = sentences.filter((sentence) => /reply|send|prepare|meet|meeting|promise|follow up|follow-up/i.test(sentence));
  const candidateUnknowns = sentences.filter((sentence) => sentence.endsWith('?') || /unknown|unsure|not sure|unclear|missing/i.test(sentence));
  const sourceIds = activeContextSources(project)
    .filter((source) => lower.includes(source.filename.toLowerCase()) || lower.includes(source.id.toLowerCase()))
    .map((source) => source.id);

  const extraction = validateStructuredOutput(contextExtractionSchema, {
    facts,
    goals,
    constraints,
    commitments,
    candidateUnknowns,
    durableMemoryCandidates: sentences.filter((sentence) => /prefer|priority|important to me|for the next/i.test(sentence)),
    sourceIds,
  });

  const createNodes = [
    ...goals.map((text) => ({ type: 'GOAL' as const, text, confidence: 0.78, impact: 0.8, sourceRefs: sourceIds })),
    ...constraints.map((text) => ({ type: 'CONSTRAINT' as const, text, confidence: 0.82, impact: 0.8, sourceRefs: sourceIds })),
    ...commitments.map((text) => ({ type: 'NEXT_ACTION' as const, text, confidence: 0.7, impact: 0.65, sourceRefs: sourceIds })),
    ...candidateUnknowns.map((text) => ({ type: 'UNKNOWN' as const, text, confidence: 0.25, impact: 0.7, sourceRefs: sourceIds })),
  ];

  const graphUpdate = validateStructuredOutput(graphUpdateSchema, {
    createNodes,
    createEdges: [],
  });

  return { extraction, graphUpdate };
}
