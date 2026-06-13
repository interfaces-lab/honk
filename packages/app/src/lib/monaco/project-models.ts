import type * as monaco from "monaco-editor";

export interface ProjectModelKey {
  readonly environmentId: string;
  readonly cwd: string;
  readonly relativePath: string;
}

export interface ProjectModelInput {
  readonly contents: string;
  readonly languageId: string;
  readonly mtimeMs: number | null;
  readonly sizeBytes: number;
}

export interface ProjectModelEntry {
  readonly model: monaco.editor.ITextModel;
  lastSavedContents: string;
  lastReadMtimeMs: number | null;
  lastReadSizeBytes: number;
  dirty: boolean;
  markSaved: (contents: string, mtimeMs: number, sizeBytes: number) => void;
  reset: (contents: string, mtimeMs: number, sizeBytes: number) => void;
}

interface RegistryEntry {
  readonly entry: ProjectModelEntry;
  readonly disposable: monaco.IDisposable;
  refCount: number;
}

// Model lifetime follows the file, not the React view (the VS Code
// ModelService pattern): the model owns the text, undo stack, and unsaved
// edits, while editor widgets are cheap and disposed per mount. So a model is
// only torn down at refCount 0 when it is clean; a dirty model is kept so a
// remount — e.g. moving the editor between the files panel and center surface
// — restores the unsaved work. Explicit close drops it via markProjectModelClosed.
const registry = new Map<string, RegistryEntry>();

// Paths the user explicitly closed: the editor is still mounted when close
// fires, so we flag the key and let the unmount's release drop the model even
// if it is dirty (an explicit close discards unsaved edits, like VS Code's
// don't-save path).
const closingKeys = new Set<string>();

function registryKey(key: ProjectModelKey): string {
  return `${key.environmentId}\u0000${key.cwd}\u0000${key.relativePath}`;
}

function projectFileUri(monacoNamespace: typeof monaco, key: ProjectModelKey): monaco.Uri {
  return monacoNamespace.Uri.parse(
    `honk-project-file://${key.environmentId}/${encodeURIComponent(key.cwd)}/${key.relativePath}`,
  );
}

function updateDirty(entry: ProjectModelEntry): void {
  entry.dirty = entry.model.getValue() !== entry.lastSavedContents;
}

export function acquireProjectModel(
  monacoNamespace: typeof monaco,
  key: ProjectModelKey,
  input: ProjectModelInput,
): ProjectModelEntry {
  const mapKey = registryKey(key);
  const existing = registry.get(mapKey);

  if (existing) {
    existing.refCount += 1;
    if (!existing.entry.dirty && input.contents !== existing.entry.lastSavedContents) {
      existing.entry.lastSavedContents = input.contents;
      existing.entry.lastReadMtimeMs = input.mtimeMs;
      existing.entry.lastReadSizeBytes = input.sizeBytes;
      existing.entry.model.setValue(input.contents);
      updateDirty(existing.entry);
    }
    return existing.entry;
  }

  const uri = projectFileUri(monacoNamespace, key);
  // Adopt a pre-existing model for this URI instead of recreating it
  // (createModel throws on a duplicate URI) — e.g. after HMR or a registry
  // reset where Monaco's global model service still holds the URI.
  const existingModel = monacoNamespace.editor.getModel(uri);
  const model =
    existingModel ?? monacoNamespace.editor.createModel(input.contents, input.languageId, uri);
  const entry: ProjectModelEntry = {
    model,
    lastSavedContents: input.contents,
    lastReadMtimeMs: input.mtimeMs,
    lastReadSizeBytes: input.sizeBytes,
    dirty: false,
    markSaved(contents, mtimeMs, sizeBytes) {
      this.lastSavedContents = contents;
      this.lastReadMtimeMs = mtimeMs;
      this.lastReadSizeBytes = sizeBytes;
      updateDirty(this);
    },
    reset(contents, mtimeMs, sizeBytes) {
      this.lastSavedContents = contents;
      this.lastReadMtimeMs = mtimeMs;
      this.lastReadSizeBytes = sizeBytes;
      this.model.setValue(contents);
      updateDirty(this);
    },
  };
  const disposable = model.onDidChangeContent(() => {
    updateDirty(entry);
  });

  registry.set(mapKey, { entry, disposable, refCount: 1 });
  return entry;
}

export function resetProjectModel(
  entry: ProjectModelEntry,
  contents: string,
  mtimeMs: number,
  sizeBytes: number,
): void {
  entry.reset(contents, mtimeMs, sizeBytes);
}

function disposeRegistryEntry(mapKey: string, existing: RegistryEntry): void {
  existing.disposable.dispose();
  existing.entry.model.dispose();
  registry.delete(mapKey);
}

export function releaseProjectModel(key: ProjectModelKey): void {
  const mapKey = registryKey(key);
  const existing = registry.get(mapKey);
  if (!existing) {
    return;
  }

  existing.refCount -= 1;
  if (existing.refCount > 0) {
    return;
  }

  const closing = closingKeys.delete(mapKey);
  // Keep dirty models alive across remounts (placement swaps, hidden panes) so
  // unsaved edits survive; a clean model — or one the user explicitly closed —
  // is dropped.
  if (existing.entry.dirty && !closing) {
    return;
  }
  disposeRegistryEntry(mapKey, existing);
}

/**
 * Flag a file as intentionally closed so its model is disposed when the editor
 * view unmounts, even if it has unsaved edits. If the view is already gone,
 * dispose immediately.
 */
export function markProjectModelClosed(key: ProjectModelKey): void {
  const mapKey = registryKey(key);
  const existing = registry.get(mapKey);
  if (!existing) {
    return;
  }
  if (existing.refCount > 0) {
    closingKeys.add(mapKey);
    return;
  }
  closingKeys.delete(mapKey);
  disposeRegistryEntry(mapKey, existing);
}
