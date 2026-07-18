import type { PromptEditorDraft } from "./types";

const STORAGE_KEY = "honk:app:composer-drafts:v1";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDraft(value: unknown): PromptEditorDraft | null {
  if (!isRecord(value) || typeof value.text !== "string" || !Array.isArray(value.files)) {
    return null;
  }
  const files = value.files.flatMap((file) => {
    if (!isRecord(file) || typeof file.path !== "string") return [];
    return [
      Object.freeze({
        path: file.path,
        ...(typeof file.filename === "string" ? { filename: file.filename } : {}),
        ...(typeof file.mime === "string" ? { mime: file.mime } : {}),
      }),
    ];
  });
  return Object.freeze({ text: value.text, files: Object.freeze(files) });
}

function hydrate(): Readonly<Record<string, PromptEditorDraft>> {
  if (typeof window === "undefined") return Object.freeze({});
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return Object.freeze({});
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return Object.freeze({});
    return Object.freeze(
      Object.fromEntries(
        Object.entries(parsed).flatMap(([key, value]) => {
          const draft = parseDraft(value);
          return draft === null ? [] : [[key, draft]];
        }),
      ),
    );
  } catch {
    return Object.freeze({});
  }
}

let drafts = hydrate();

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        Object.fromEntries(
          // Object URLs and pasted data URLs are valid for the live app session, but persisting
          // them would synchronously serialize large payloads on every keystroke.
          Object.entries(drafts).filter(([, draft]) =>
            draft.files.every(
              (file) => !file.path.startsWith("data:") && !file.path.startsWith("blob:"),
            ),
          ),
        ),
      ),
    );
  } catch {
    // Storage limits must not discard the in-memory draft used during navigation.
  }
}

export function readComposerDraft(key: string): PromptEditorDraft | undefined {
  return drafts[key];
}

export function writeComposerDraft(key: string, draft: PromptEditorDraft): void {
  if (draft.text.length === 0 && draft.files.length === 0) {
    const { [key]: _removed, ...remaining } = drafts;
    drafts = Object.freeze(remaining);
    persist();
    return;
  }
  drafts = Object.freeze({
    ...drafts,
    [key]: Object.freeze({
      text: draft.text,
      files: Object.freeze(draft.files.map((file) => Object.freeze({ ...file }))),
    }),
  });
  persist();
}
