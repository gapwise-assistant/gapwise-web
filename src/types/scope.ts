export type AppScope =
  | { type: 'everything' }
  | { type: 'project'; projectId: string };

export const EVERYTHING_SCOPE: AppScope = { type: 'everything' };

export function scopeProjectId(scope: AppScope): string | undefined {
  return scope.type === 'project' ? scope.projectId : undefined;
}

export function scopeStorageKey(scope: AppScope): string {
  return scope.type === 'project' ? `project:${scope.projectId}` : 'everything';
}
