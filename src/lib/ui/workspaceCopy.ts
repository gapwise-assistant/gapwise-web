/**
 * Applies the product's current workspace terminology at presentation time.
 * Stored history and source text remain unchanged.
 */
export function workspaceCopy(value: string): string {
  return value
    .replace(/\bPROJECTS\b/g, 'WORKSPACES')
    .replace(/\bPROJECT\b/g, 'WORKSPACE')
    .replace(/\bProjects\b/g, 'Workspaces')
    .replace(/\bProject\b/g, 'Workspace')
    .replace(/\bprojects\b/g, 'workspaces')
    .replace(/\bproject\b/g, 'workspace');
}
