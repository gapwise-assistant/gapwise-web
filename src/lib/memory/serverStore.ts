import { DurableMemory } from '@/types/contextPack';
import { UserMemoryProfile } from '@/types/clarity';
import { memoriesFromProfile } from '@/lib/memory/store';
import { getStorageProvider } from '@/lib/storage';

function withUser(userId: string, memory: DurableMemory): DurableMemory {
  return {
    ...memory,
    userId,
    status: memory.forgotten_at ? 'forgotten' : 'active',
    createdAt: memory.created_at,
    updatedAt: memory.updated_at,
    lastConfirmedAt: memory.last_confirmed_at,
    provenance: memory.why_remembered,
  };
}

export async function loadDurableMemories(userId: string, profile: UserMemoryProfile): Promise<DurableMemory[]> {
  const storage = getStorageProvider();
  const existing = await storage.getMemories(userId);
  if (existing.length) return existing.map((memory) => withUser(userId, memory));

  const seeded = memoriesFromProfile(profile).map((memory) => withUser(userId, memory));
  await storage.replaceMemories(userId, seeded);
  return seeded;
}

export async function saveDurableMemory(userId: string, memory: DurableMemory): Promise<DurableMemory> {
  const saved = withUser(userId, memory);
  await getStorageProvider().saveMemory(userId, saved);
  return saved;
}

export async function replaceDurableMemories(userId: string, memories: DurableMemory[]): Promise<DurableMemory[]> {
  const saved = memories.map((memory) => withUser(userId, memory));
  await getStorageProvider().replaceMemories(userId, saved);
  return saved;
}
