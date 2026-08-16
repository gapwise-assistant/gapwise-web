export type PrimaryDestination = 'today' | 'ask' | 'scope';
export type AppDestination = PrimaryDestination | 'settings';

export const PRIMARY_NAVIGATION: ReadonlyArray<{ id: PrimaryDestination; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'ask', label: 'Ask' },
  { id: 'scope', label: 'Workspace' },
];
