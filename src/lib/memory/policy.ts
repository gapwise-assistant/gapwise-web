import { DurableMemory, MemoryCategory } from '@/types/contextPack';

const TRANSIENT_PATTERNS = [
  /\btoday i feel\b/i,
  /\bi am tired\b/i,
  /\bi'm tired\b/i,
  /\btemporary\b/i,
  /\bright now\b/i,
  /\bthis afternoon\b/i,
  /\bfor lunch\b/i,
];

const EXPLICIT_MEMORY_PATTERNS = [
  /\bremember that\b/i,
  /\bmy preference is\b/i,
  /\bi prefer\b/i,
  /\bmy priority is\b/i,
  /\btop priority\b/i,
  /\bfor the next \d+ (days|weeks|months)\b/i,
];

export function classifyMemoryCategory(text: string): MemoryCategory {
  const lower = text.toLowerCase();
  if (/priority|next \d+|focus|important/.test(lower)) return 'current_priorities';
  if (/career|job|recruiter|salary|startup|financial|pricing|work/.test(lower)) return 'career';
  if (/concise|detailed|tone|question|explain|communication/.test(lower)) return 'communication';
  if (/learn|learning|research|course|study|agentic|ai/.test(lower)) return 'learning';
  return 'custom';
}

export function shouldPromoteToDurableMemory(text: string): {
  promote: boolean;
  reason: string;
  category: MemoryCategory;
  expiresAt?: string;
} {
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      promote: false,
      reason: 'Transient or short-lived statement; not promoted by default.',
      category: classifyMemoryCategory(text),
    };
  }

  const explicit = EXPLICIT_MEMORY_PATTERNS.some((pattern) => pattern.test(text));
  if (!explicit) {
    return {
      promote: false,
      reason: 'No explicit stable preference, priority, or repeated high-confidence fact detected.',
      category: classifyMemoryCategory(text),
    };
  }

  const monthsMatch = text.match(/for the next (\d+) months/i);
  const expiresAt = monthsMatch
    ? new Date(Date.now() + Number(monthsMatch[1]) * 30 * 24 * 60 * 60 * 1000).toISOString()
    : undefined;

  return {
    promote: true,
    reason: 'Explicit stable preference or priority stated by the user.',
    category: classifyMemoryCategory(text),
    expiresAt,
  };
}

export function createDurableMemory(text: string, sourceRefs: string[] = []): DurableMemory | null {
  const decision = shouldPromoteToDurableMemory(text);
  if (!decision.promote) return null;
  const now = new Date().toISOString();
  return {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    category: decision.category,
    text,
    source: 'explicit',
    source_refs: sourceRefs,
    confidence: 0.92,
    created_at: now,
    updated_at: now,
    last_confirmed_at: now,
    expires_at: decision.expiresAt,
    why_remembered: decision.reason,
  };
}
