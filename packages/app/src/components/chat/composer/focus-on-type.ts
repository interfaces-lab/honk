import { useEffect, type RefObject } from "react";
import { isMacPlatform } from "~/lib/utils";
import type { ComposerPromptEditorHandle } from "./prompt-editor";

interface ComposerFocusOnTypeOptions {
  enabled: boolean;
  promptInputRef: RefObject<ComposerPromptEditorHandle | null>;
  targetWindow?: Window;
  isEditorPanelFocused?: () => boolean;
}

interface ComposerFocusOnTypeGuardInput {
  event: KeyboardEvent;
  activeElement: Element | null;
  editorPanelFocused: boolean;
  hasWindowFocus: boolean;
}

function isEditableElement(element: Element | null): boolean {
  if (!element) return false;
  const tagName = element.tagName;
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

function isPrintableKey(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey ? false : event.key.length === 1;
}

function isPasteShortcut(event: KeyboardEvent): boolean {
  const modifierPressed = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
  return event.key.toLowerCase() === "v" && modifierPressed && !event.altKey;
}

function canFocusPromptOnType(input: ComposerFocusOnTypeGuardInput): boolean {
  return !(
    input.event.defaultPrevented ||
    isEditableElement(input.activeElement) ||
    input.editorPanelFocused ||
    !input.hasWindowFocus
  );
}

function focusAndInsertText(promptInput: ComposerPromptEditorHandle, text: string): void {
  if (!text) return;
  promptInput.focus();
  promptInput.insertText(text);
}

export function useComposerFocusOnType({
  enabled,
  promptInputRef,
  targetWindow,
  isEditorPanelFocused,
}: ComposerFocusOnTypeOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const resolvedTargetWindow = targetWindow ?? window;

    const canFocus = (event: KeyboardEvent) =>
      canFocusPromptOnType({
        event,
        activeElement: resolvedTargetWindow.document.activeElement,
        editorPanelFocused: isEditorPanelFocused?.() ?? false,
        hasWindowFocus: resolvedTargetWindow.document.hasFocus(),
      });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isPasteShortcut(event)) {
        if (!canFocus(event)) return;
        const promptInput = promptInputRef.current;
        if (!promptInput) return;
        // Focus only; let the browser dispatch the real paste event so file/image
        // clipboard payloads stay available to the composer paste handler.
        promptInput.focus();
        return;
      }

      if (!isPrintableKey(event) || !canFocus(event)) return;
      const promptInput = promptInputRef.current;
      if (!promptInput) return;
      focusAndInsertText(promptInput, event.key);
      event.preventDefault();
    };

    resolvedTargetWindow.addEventListener("keydown", handleKeyDown);
    return () => {
      resolvedTargetWindow.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, isEditorPanelFocused, promptInputRef, targetWindow]);
}
