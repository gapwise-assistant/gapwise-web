import { Project } from '@/types/clarity';

export interface CreateProjectInput {
  name: string;
  goal: string;
  description?: string;
  deadline?: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project';
}

function projectIdFor(input: CreateProjectInput, createdAt: string): string {
  const timestamp = Date.parse(createdAt);
  return `project_${slugify(input.name)}_${Number.isFinite(timestamp) ? timestamp : Date.now()}`;
}

export function createProjectFromInput(input: CreateProjectInput, createdAt = new Date().toISOString()): Project {
  const trimmedName = input.name.trim();
  const trimmedGoal = input.goal.trim();
  const description = input.description?.trim();
  const deadline = input.deadline?.trim();
  const projectId = projectIdFor({ ...input, name: trimmedName, goal: trimmedGoal }, createdAt);
  const goalNodeId = `goal_${projectId}`;

  return {
    id: projectId,
    title: trimmedName,
    goal: trimmedGoal,
    status: 'active',
    deadline: deadline || undefined,
    one_sentence_context: description || undefined,
    clarity_score: 20,
    created_at: createdAt,
    updated_at: createdAt,
    nodes: [
      {
        id: goalNodeId,
        type: 'GOAL',
        text: trimmedGoal,
        status: 'OPEN',
        confidence: 1,
        impact: 0.9,
        source_refs: [],
        created_by: 'user',
        created_at: createdAt,
        updated_at: createdAt,
        x: 350,
        y: 100,
      },
    ],
    edges: [],
    sources: [],
    active_question: null,
    history: [],
  };
}
