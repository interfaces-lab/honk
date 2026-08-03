import type { PromptComposerFile } from "../open-code-view";

export type PromptCommand = {
  readonly name: string;
  readonly arguments: string;
};

export type PromptSubmit = {
  readonly text: string;
  readonly files: readonly PromptComposerFile[];
  readonly editorState: string;
  readonly command: PromptCommand | null;
  // Command(mac)/Ctrl+Enter. The thread composer sends immediately instead of queueing.
  readonly sendNow: boolean;
};

export type PromptEditorDraft = {
  readonly text: string;
  readonly files: readonly PromptComposerFile[];
  readonly editorState?: string;
};

export type ThreadMessageEdit = PromptEditorDraft & {
  readonly messageID: string;
  readonly requiresRevertConfirmation: boolean;
};

export type PromptEditorHandle = {
  readonly submit: () => void;
  readonly focus: () => void;
  readonly insertText: (text: string) => void;
  readonly setDraft: (draft: PromptEditorDraft) => void;
  readonly chooseImages: () => void;
};
