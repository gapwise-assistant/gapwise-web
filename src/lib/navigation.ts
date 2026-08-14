export type PrimaryDestination = 'today' | 'ask' | 'context' | 'scope';
export type AppDestination = PrimaryDestination | 'settings';

export const PRIMARY_NAVIGATION: ReadonlyArray<{ id: PrimaryDestination; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'ask', label: 'Ask' },
  { id: 'context', label: 'Context' },
  { id: 'scope', label: 'Workspace' },
];
