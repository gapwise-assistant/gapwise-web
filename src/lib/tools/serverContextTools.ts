import 'server-only';

import { Project } from '@/types/clarity';
import { loadProject } from '@/lib/storage';

export async function getUserContext(userId: string): Promise<Project> {
  return loadProject(userId);
}
