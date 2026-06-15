import { useEffect, type RefObject } from "react";
import { isMacPlatform } from "~/lib/utils";
import type { ComposerPromptEditorHandle } from "./prompt-editor";

interface ComposerFocusOnTypeOptions {
  enabled: boolean;
  promptInputRef: RefObject<ComposerPromptEditorHandle | null>;
  targetWindow?: Window;
  isEditorPanelFocused?: () => boolean;
  readClipboardText?: () => Promise<string>;
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

function readClipboardTextFromNavigator(): Promise<string> {
  return navigator.clipboard?.readText() ?? Promise.resolve("");
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
  readClipboardText,
}: ComposerFocusOnTypeOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const resolvedTargetWindow = targetWindow ?? window;
    const resolvedReadClipboardText = readClipboardText ?? readClipboardTextFromNavigator;
    let generation = 0;

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
        const pasteGeneration = ++generation;
        event.preventDefault();
        promptInput.focus();
        resolvedReadClipboardText()
          .then((text) => {
            if (pasteGeneration !== generation || !text) return;
            promptInputRef.current?.insertText(text);
          })
          .catch(() => {});
        return;
      }

      generation++;
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
  }, [enabled, isEditorPanelFocused, promptInputRef, readClipboardText, targetWindow]);
}
