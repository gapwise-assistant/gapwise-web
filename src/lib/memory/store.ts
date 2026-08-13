import { DurableMemory, MemoryCategory } from '@/types/contextPack';
import { UserMemoryProfile } from '@/types/clarity';

const MEMORY_STORAGE_PREFIX = 'gapwise_memories_';

function nowIso(): string {
  return new Date().toISOString();
}

export function memoriesFromProfile(profile: UserMemoryProfile): DurableMemory[] {
  const notes = profile.durable_notes ?? [];
  return notes.map((note, index) => ({
    id: `seed_memory_${index}`,
    category: note.toLowerCase().includes('question') ? 'communication' : 'career',
    text: note,
    source: 'seed',
    source_refs: [],
    confidence: 0.8,
    created_at: '2026-08-10T10:00:00Z',
    updated_at: '2026-08-10T10:00:00Z',
    last_confirmed_at: '2026-08-10T10:00:00Z',
    why_remembered: 'Seeded from the default demo profile.',
  }));
}

export function activeMemories(memories: DurableMemory[]): DurableMemory[] {
  const now = Date.now();
  return memories.filter((memory) => {
    if (memory.forgotten_at) return false;
    if (!memory.expires_at) return true;
    return new Date(memory.expires_at).getTime() > now;
  });
}

export function editMemory(memories: DurableMemory[], memoryId: string, text: string, category?: MemoryCategory): DurableMemory[] {
  return memories.map((memory) =>
    memory.id === memoryId
      ? {
          ...memory,
          text,
          category: category ?? memory.category,
          updated_at: nowIso(),
        }
      : memory
  );
}

export function forgetMemory(memories: DurableMemory[], memoryId: string): DurableMemory[] {
  return memories.map((memory) =>
    memory.id === memoryId
      ? {
          ...memory,
          forgotten_at: nowIso(),
          updated_at: nowIso(),
        }
      : memory
  );
}

export function confirmMemory(memories: DurableMemory[], memoryId: string): DurableMemory[] {
  const now = nowIso();
  return memories.map((memory) =>
    memory.id === memoryId
      ? {
          ...memory,
          last_confirmed_at: now,
          updated_at: now,
          confidence: Math.min(1, Number((memory.confidence + 0.05).toFixed(2))),
        }
      : memory
  );
}

export function loadMemoriesFromBrowser(userId: string, profile: UserMemoryProfile): DurableMemory[] {
  if (typeof window === 'undefined') return memoriesFromProfile(profile);
  const stored = localStorage.getItem(`${MEMORY_STORAGE_PREFIX}${userId}`);
  if (!stored) return memoriesFromProfile(profile);
  try {
    return JSON.parse(stored) as DurableMemory[];
  } catch {
    return memoriesFromProfile(profile);
  }
}

export function saveMemoriesToBrowser(userId: string, memories: DurableMemory[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${MEMORY_STORAGE_PREFIX}${userId}`, JSON.stringify(memories));
}
