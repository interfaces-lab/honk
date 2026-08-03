import * as React from "react";

import type { PromptEditorHandle } from "./types";

// Fields, popup layers, and typeahead surfaces keep their own keystrokes.
const PROTECTED_TARGETS = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="searchbox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-slot="popover"]',
  '[data-slot^="picker-"]',
  "[data-directory-picker]",
].join(", ");

// Space activates a focused control; only letters and symbols fall through to the composer.
const SPACE_ACTIVATED_TARGETS = [
  "button",
  "a[href]",
  "summary",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="link"]',
].join(", ");

const SCOPE_MARKER_SELECTOR = "[data-focus-on-type-scope]";

// "window" steals stray typing anywhere outside a marked scope; a ref steals only while focus sits
// inside that element. Undefined disables the listener entirely.
export type FocusOnTypeScope = "window" | React.RefObject<HTMLElement | null>;

/**
 * Route stray printable keystrokes into the prompt editor, the way Cursor's composer does: when no
 * field owns the keyboard, typing focuses the composer and the first character lands in the draft.
 * Paste chords only move focus so the native paste (including images) reaches the editor untouched.
 */
export function useFocusOnType(
  editorRef: React.RefObject<PromptEditorHandle | null>,
  scope: FocusOnTypeScope | undefined,
): void {
  React.useEffect(() => {
    if (scope === undefined) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!qualifiesForSteal(event)) return;
      const active = document.activeElement;
      if (isProtectedTarget(active, event.key)) return;
      if (!scopeAllowsSteal(scope, active)) return;
      const editor = editorRef.current;
      if (editor === null) return;

      if (event.metaKey || event.ctrlKey) {
        // Paste chord: focus only, so the browser delivers the paste event to the editor.
        editor.focus();
        return;
      }
      editor.insertText(event.key);
      event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editorRef, scope]);
}

function qualifiesForSteal(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false;
  // Explicit IME guard: mid-composition keys must never leak into the editor.
  if (event.isComposing || event.keyCode === 229) return false;
  if (!document.hasFocus()) return false;
  const isPaste =
    event.key.toLowerCase() === "v" && (event.metaKey || event.ctrlKey) && !event.altKey;
  if (isPaste) return true;
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function isProtectedTarget(active: Element | null, key: string): boolean {
  if (active === null || active === document.body) return false;
  if (active.closest(PROTECTED_TARGETS) !== null) return true;
  return key === " " && active.closest(SPACE_ACTIVATED_TARGETS) !== null;
}

function scopeAllowsSteal(scope: FocusOnTypeScope, active: Element | null): boolean {
  if (scope === "window") {
    // Scoped surfaces (side chats) own typing while focus sits inside them.
    return active === null || active.closest(SCOPE_MARKER_SELECTOR) === null;
  }
  const element = scope.current;
  return element !== null && active !== null && element.contains(active);
}
