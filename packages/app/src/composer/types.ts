import type { PromptComposerFile } from "../open-code-view";

export type PromptCommand = {
  readonly name: string;
  readonly arguments: string;
};

export type PromptSubmit = {
  readonly text: string;
  readonly files: readonly PromptComposerFile[];
  readonly command: PromptCommand | null;
};

export type PromptEditorDraft = {
  readonly text: string;
  readonly files: readonly PromptComposerFile[];
};

export type ThreadMessageEdit = PromptEditorDraft & {
  readonly messageID: string;
  readonly requiresRevertConfirmation: boolean;
};

export type PromptEditorHandle = {
  readonly submit: () => void;
  readonly focus: () => void;
  readonly chooseImages: () => void;
};
