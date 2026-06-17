import type { ResolvedKeybindingsConfig } from "@honk/contracts";
import * as monaco from "monaco-editor";
import { useEffect } from "react";

import { shortcutLabelForCommand } from "~/keybindings";

export interface EditorSelectionToChatPayload {
  path: string;
  label: string | null;
  lineStart: number;
  lineEnd: number;
  text: string;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

class ProjectEditorSelectionContentWidget implements monaco.editor.IContentWidget {
  private readonly element: HTMLButtonElement;
  private selection: monaco.Selection | null = null;

  constructor(
    private readonly editor: monaco.editor.IStandaloneCodeEditor,
    private readonly relativePath: string,
    private keybindings: ResolvedKeybindingsConfig,
    private readonly onAddSelectionToChat: (payload: EditorSelectionToChatPayload) => void,
  ) {
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className =
      "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-honk-stroke-tertiary bg-(--honk-workbench-panel-background) px-2 py-1 text-detail text-honk-fg-primary shadow-md";
    this.element.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    this.element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.addSelectionToChat();
    });
    this.updateLabel();
  }

  getId(): string {
    return "honk.projectEditor.addSelectionToChat";
  }

  getDomNode(): HTMLElement {
    return this.element;
  }

  getPosition(): monaco.editor.IContentWidgetPosition | null {
    if (!this.selection) return null;
    return {
      position: {
        lineNumber: this.selection.endLineNumber,
        column: this.selection.endColumn,
      },
      preference: [
        monaco.editor.ContentWidgetPositionPreference.ABOVE,
        monaco.editor.ContentWidgetPositionPreference.BELOW,
      ],
    };
  }

  updateSelection(selection: monaco.Selection | null): void {
    this.selection = selection;
    this.editor.layoutContentWidget(this);
  }

  updateKeybindings(keybindings: ResolvedKeybindingsConfig): void {
    this.keybindings = keybindings;
    this.updateLabel();
  }

  addSelectionToChat(): void {
    const selection = this.selection;
    const model = this.editor.getModel();
    if (!selection || selection.isEmpty() || !model) return;
    this.onAddSelectionToChat({
      path: this.relativePath,
      label: basename(this.relativePath),
      lineStart: selection.startLineNumber,
      lineEnd: selection.endLineNumber,
      text: model.getValueInRange(selection),
    });
  }

  private updateLabel(): void {
    const shortcut = shortcutLabelForCommand(this.keybindings, "editor.addSelectionToChat", {
      context: { editorFocus: true, terminalFocus: false, terminalOpen: false },
    });
    this.element.textContent = shortcut ? `Add to Chat ${shortcut}` : "Add to Chat";
  }
}

export function ProjectEditorSelectionWidget(props: {
  editor: monaco.editor.IStandaloneCodeEditor | null;
  relativePath: string;
  keybindings: ResolvedKeybindingsConfig;
  onAddSelectionToChat: (payload: EditorSelectionToChatPayload) => void;
}) {
  useEffect(() => {
    const editor = props.editor;
    if (!editor) return undefined;

    const widget = new ProjectEditorSelectionContentWidget(
      editor,
      props.relativePath,
      props.keybindings,
      props.onAddSelectionToChat,
    );
    const syncSelection = () => {
      const selection = editor.getSelection();
      const hasFocus = editor.hasTextFocus();
      widget.updateSelection(selection && !selection.isEmpty() && hasFocus ? selection : null);
    };

    editor.addContentWidget(widget);
    const selectionDisposable = editor.onDidChangeCursorSelection(syncSelection);
    const focusDisposable = editor.onDidFocusEditorText(syncSelection);
    const blurDisposable = editor.onDidBlurEditorText(() => widget.updateSelection(null));
    syncSelection();

    return () => {
      selectionDisposable.dispose();
      focusDisposable.dispose();
      blurDisposable.dispose();
      editor.removeContentWidget(widget);
    };
  }, [props.editor, props.keybindings, props.onAddSelectionToChat, props.relativePath]);

  return null;
}
