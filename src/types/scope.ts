/**
 * The scope users can actively work in. A workspace is always one project.
 */
export type WorkspaceScope = { type: 'project'; projectId: string };

/**
 * AppScope still includes the legacy aggregate value so old persisted
 * preferences and internal/general-context integrations remain readable.
 * New UI state and writes should use WorkspaceScope.
 */
export type AppScope =
  | WorkspaceScope
  | { type: 'everything' };

export const EVERYTHING_SCOPE: AppScope = { type: 'everything' };

export function scopeProjectId(scope: AppScope): string | undefined {
  return scope.type === 'project' ? scope.projectId : undefined;
}

export function scopeStorageKey(scope: AppScope): string {
  return scope.type === 'project' ? `project:${scope.projectId}` : 'everything';
}
