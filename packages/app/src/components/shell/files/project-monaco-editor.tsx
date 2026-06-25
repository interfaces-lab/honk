import type { EnvironmentId, ProjectReadFileResult } from "@honk/contracts";
import { getFiletypeFromFileName } from "@pierre/diffs";
import * as monaco from "monaco-editor";
import { useEffect, useLayoutEffect, useRef } from "react";

import { useTheme } from "~/hooks/use-theme";
import {
  acquireProjectModel,
  releaseProjectModel,
  resetProjectModel,
  type ProjectModelEntry,
  type ProjectModelKey,
} from "~/lib/monaco/project-models";
import { defineHonkMonacoThemes, resolveMonacoThemeName } from "~/lib/monaco/theme";
import { setupMonacoEnvironment } from "~/lib/monaco/workers";
import { readAppearanceSnapshot, subscribeAppearanceSettings } from "~/lib/appearance-settings";

setupMonacoEnvironment();
defineHonkMonacoThemes(monaco);

// Monaco measures glyphs from this string directly, so it must stay a concrete
// font list (no CSS var()); a custom code font arrives via appearance.codeFont.
const FALLBACK_MONO_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

function editorFontOptions(): Pick<
  monaco.editor.IStandaloneEditorConstructionOptions,
  "fontFamily" | "fontSize" | "lineHeight"
> {
  const appearance = readAppearanceSnapshot();
  return {
    fontFamily: appearance.codeFont || FALLBACK_MONO_FONT,
    fontSize: appearance.codeFontSize,
    lineHeight: appearance.codeFontSize + 8,
  };
}

function sameProjectModelKey(left: ProjectModelKey, right: ProjectModelKey): boolean {
  return (
    left.environmentId === right.environmentId &&
    left.cwd === right.cwd &&
    left.relativePath === right.relativePath
  );
}

export type ProjectMonacoModelEntry = {
  readonly key: ProjectModelKey;
  readonly entry: ProjectModelEntry;
};

export function ProjectMonacoEditor(props: {
  cwd: string;
  environmentId: EnvironmentId;
  relativePath: string;
  fileData: ProjectReadFileResult | null;
  wordWrap: boolean;
  onDirtyChange: (dirty: boolean, modelEntry: ProjectMonacoModelEntry) => void;
  onSaveRequest: (modelEntry: ProjectMonacoModelEntry) => void;
  onModelEntryChange?: (modelEntry: ProjectMonacoModelEntry | null) => void;
  onEditorReady?: (editor: monaco.editor.IStandaloneCodeEditor | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelEntryRef = useRef<ProjectModelEntry | null>(null);
  const modelKeyRef = useRef<ProjectModelKey | null>(null);
  const contentDisposableRef = useRef<monaco.IDisposable | null>(null);
  const onDirtyChangeRef = useRef(props.onDirtyChange);
  const onModelEntryChangeRef = useRef(props.onModelEntryChange);
  const onEditorReadyRef = useRef(props.onEditorReady);
  const wordWrapRef = useRef(props.wordWrap);
  const { resolvedTheme } = useTheme();

  onDirtyChangeRef.current = props.onDirtyChange;
  onModelEntryChangeRef.current = props.onModelEntryChange;
  onEditorReadyRef.current = props.onEditorReady;
  wordWrapRef.current = props.wordWrap;

  const releaseCurrentModel = () => {
    contentDisposableRef.current?.dispose();
    contentDisposableRef.current = null;
    editorRef.current?.setModel(null);
    const key = modelKeyRef.current;
    modelEntryRef.current = null;
    modelKeyRef.current = null;
    onModelEntryChangeRef.current?.(null);
    if (key) {
      releaseProjectModel(key);
    }
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      model: null,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "on",
      glyphMargin: false,
      folding: true,
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, bracketPairs: true },
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      contextmenu: false,
      wordWrap: wordWrapRef.current ? "on" : "off",
      readOnly: props.fileData === null,
      padding: { top: 12, bottom: 24 },
      theme: resolveMonacoThemeName(resolvedTheme),
      ...editorFontOptions(),
    });
    editorRef.current = editor;
    onEditorReadyRef.current?.(editor);
    const unsubscribeAppearance = subscribeAppearanceSettings(() => {
      editor.updateOptions(editorFontOptions());
    });

    return () => {
      unsubscribeAppearance();
      releaseCurrentModel();
      editor.dispose();
      editorRef.current = null;
      onEditorReadyRef.current?.(null);
    };
  }, []);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const fileData = props.fileData;
    if (!fileData) {
      releaseCurrentModel();
      editor.updateOptions({ readOnly: true });
      return;
    }

    const key = {
      environmentId: props.environmentId,
      cwd: props.cwd,
      relativePath: props.relativePath,
    };
    const languageId = fileData.syntax.languageId ?? getFiletypeFromFileName(props.relativePath);
    const currentKey = modelKeyRef.current;
    let entry = modelEntryRef.current;
    if (!entry || !currentKey || !sameProjectModelKey(currentKey, key)) {
      releaseCurrentModel();
      const acquiredEntry = acquireProjectModel(monaco, key, {
        contents: fileData.contents,
        languageId,
        mtimeMs: fileData.mtimeMs,
        sizeBytes: fileData.sizeBytes,
      });
      entry = acquiredEntry;
      modelEntryRef.current = entry;
      modelKeyRef.current = key;
      editor.setModel(entry.model);
      contentDisposableRef.current = acquiredEntry.model.onDidChangeContent(() => {
        onDirtyChangeRef.current(acquiredEntry.dirty, { key, entry: acquiredEntry });
      });
    }
    if (!entry) return;

    monaco.editor.setModelLanguage(entry.model, languageId);
    editor.updateOptions({ readOnly: false });
    const activeModelEntry = { key, entry };
    onModelEntryChangeRef.current?.(activeModelEntry);
    if (entry.dirty) {
      onDirtyChangeRef.current(entry.dirty, activeModelEntry);
      return;
    }
    if (
      fileData.contents === entry.lastSavedContents &&
      fileData.mtimeMs === entry.lastReadMtimeMs &&
      fileData.sizeBytes === entry.lastReadSizeBytes
    ) {
      onDirtyChangeRef.current(entry.dirty, activeModelEntry);
      return;
    }
    resetProjectModel(entry, fileData.contents, fileData.mtimeMs, fileData.sizeBytes);
    onDirtyChangeRef.current(entry.dirty, activeModelEntry);
  }, [
    props.cwd,
    props.environmentId,
    props.relativePath,
    props.fileData?.contents,
    props.fileData?.mtimeMs,
    props.fileData?.sizeBytes,
    props.fileData?.syntax.languageId,
  ]);

  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap: props.wordWrap ? "on" : "off" });
  }, [props.wordWrap]);

  useEffect(() => {
    monaco.editor.setTheme(resolveMonacoThemeName(resolvedTheme));
  }, [resolvedTheme]);

  return <div ref={containerRef} className="project-monaco-editor" />;
}
