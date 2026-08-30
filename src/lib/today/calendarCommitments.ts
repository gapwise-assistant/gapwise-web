import type { ClarityNode } from '@/types/clarity';

const CALENDAR_SOURCE_PREFIX = 'gcal_';
const NORMALIZED_COMMITMENT_PREFIX = 'gcal_commitment_';

/**
 * Returns the provider event identity carried by a Calendar source reference.
 * Normalized commitment node IDs are deliberately not used as identity: the
 * same event may be rebuilt into a different temporary node instance.
 */
export function calendarEventIdFromNode(node: ClarityNode): string | undefined {
  const sourceRef = node.source_refs.find((ref) =>
    ref.startsWith(CALENDAR_SOURCE_PREFIX)
    && !ref.startsWith(NORMALIZED_COMMITMENT_PREFIX)
  );
  return sourceRef?.slice(CALENDAR_SOURCE_PREFIX.length) || undefined;
}

/** A graph node that has Calendar provenance, regardless of its role. */
export function isCalendarBackedNode(node: ClarityNode): boolean {
  return Boolean(calendarEventIdFromNode(node))
    || node.why_it_matters?.includes('Source: Google Calendar') === true;
}

/**
 * The temporary, schedule-aware event representation produced by
 * calendarEventsToCommitmentNodes(). Persistent project actions can share
 * the same Calendar provenance but must not be rendered as event cards.
 */
export function isNormalizedCalendarCommitment(node: ClarityNode): boolean {
  if (!node.id.startsWith(NORMALIZED_COMMITMENT_PREFIX)) return false;
  const valid = Boolean(calendarEventIdFromNode(node)) && isCalendarBackedNode(node);
  if (!valid && process.env.NODE_ENV !== 'production') {
    console.debug('[Today] Ignoring malformed normalized Calendar commitment', {
      nodeId: node.id,
      sourceRefs: node.source_refs,
    });
  }
  return valid;
}
