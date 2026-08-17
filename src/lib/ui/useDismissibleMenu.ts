import * as React from 'react';

export const MENU_CLOSE_EVENT = 'gapswise:close-menus';

export function closeOpenMenus(): void {
  window.dispatchEvent(new Event(MENU_CLOSE_EVENT));
}

export function useDismissibleMenu(
  isOpen: boolean,
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>,
  menuRef: React.RefObject<HTMLElement | null>,
): void {
  React.useEffect(() => {
    const closeOtherMenus = () => setIsOpen(false);
    window.addEventListener(MENU_CLOSE_EVENT, closeOtherMenus);
    return () => window.removeEventListener(MENU_CLOSE_EVENT, closeOtherMenus);
  }, [setIsOpen]);

  React.useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, menuRef, setIsOpen]);
}
