"use client";
import { useEffect, type RefObject } from "react";

/** Keyboard behavior for the native details-based mobile menus. */
export function useMenuDialog(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const close = (returnFocus: boolean) => {
      element.open = false;
      if (returnFocus) element.querySelector<HTMLElement>("summary")?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!element.open) return;
      if (event.key === "Escape") { event.preventDefault(); close(true); return; }
      if (event.key !== "Tab") return;
      const items = [...element.querySelectorAll<HTMLElement>('summary, a[href], button:not([disabled]):not([tabindex="-1"])')].filter(item => item.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1], active = document.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
  }, [ref]);
}

export function MenuBackdrop({ menu }: { menu: RefObject<HTMLDetailsElement | null> }) {
  return <button type="button" className="menu-backdrop" tabIndex={-1} aria-label="关闭菜单" onClick={() => { const element = menu.current; if (element) { element.open = false; element.querySelector<HTMLElement>("summary")?.focus(); } }} />;
}