'use client';

import { useEffect, type RefObject } from 'react';

export type DismissibleModalElement = Pick<Element, 'contains'>;

export function isEscapeKey(event: Pick<KeyboardEvent, 'key'>): boolean {
  return event.key === 'Escape';
}

/** Returns true when an event target is outside the modal panel. */
export function isOutsideModalTarget(
  target: EventTarget | null,
  modal: DismissibleModalElement | null | undefined,
): boolean {
  return Boolean(modal && target && !modal.contains(target as Node));
}

/** Adds the consistent Escape and outside-click behavior used by modal panels. */
export function useDismissibleModal(
  onClose: () => void,
  modalRef: RefObject<DismissibleModalElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isEscapeKey(event)) return;
      event.preventDefault();
      onClose();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (isOutsideModalTarget(event.target, modalRef.current)) onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [enabled, modalRef, onClose]);
}
