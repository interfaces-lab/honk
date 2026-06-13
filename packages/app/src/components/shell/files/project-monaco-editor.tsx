import type { EnvironmentId, ProjectReadFileResult } from "@honk/contracts";
import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";

import { useTheme } from "~/hooks/use-theme";
import {
  acquireProjectModel,
  releaseProjectModel,
  resetProjectModel,
  type ProjectModelEntry,
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

export function ProjectMonacoEditor(props: {
  cwd: string;
  environmentId: EnvironmentId;
  relativePath: string;
  fileData: ProjectReadFileResult;
  wordWrap: boolean;
  onDirtyChange: (dirty: boolean, entry: ProjectModelEntry) => void;
  onSaveRequest: (entry: ProjectModelEntry) => void;
  onEditorReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelEntryRef = useRef<ProjectModelEntry | null>(null);
  const onDirtyChangeRef = useRef(props.onDirtyChange);
  const onEditorReadyRef = useRef(props.onEditorReady);
  const fileDataRef = useRef(props.fileData);
  const wordWrapRef = useRef(props.wordWrap);
  const { resolvedTheme } = useTheme();

  onDirtyChangeRef.current = props.onDirtyChange;
  onEditorReadyRef.current = props.onEditorReady;
  fileDataRef.current = props.fileData;
  wordWrapRef.current = props.wordWrap;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const key = {
      environmentId: props.environmentId,
      cwd: props.cwd,
      relativePath: props.relativePath,
    };
    const fileData = fileDataRef.current;
    const entry = acquireProjectModel(monaco, key, {
      contents: fileData.contents,
      languageId: fileData.syntax.languageId,
      mtimeMs: fileData.mtimeMs,
      sizeBytes: fileData.sizeBytes,
    });
    modelEntryRef.current = entry;

    const editor = monaco.editor.create(container, {
      model: entry.model,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "on",
      glyphMargin: false,
      folding: true,
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, bracketPairs: true },
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      wordWrap: wordWrapRef.current ? "on" : "off",
      padding: { top: 12, bottom: 24 },
      theme: resolveMonacoThemeName(resolvedTheme),
      ...editorFontOptions(),
    });
    editorRef.current = editor;
    onEditorReadyRef.current?.(editor);
    onDirtyChangeRef.current(entry.dirty, entry);

    const contentDisposable = entry.model.onDidChangeContent(() => {
      onDirtyChangeRef.current(entry.dirty, entry);
    });
    const unsubscribeAppearance = subscribeAppearanceSettings(() => {
      editor.updateOptions(editorFontOptions());
    });

    return () => {
      unsubscribeAppearance();
      contentDisposable.dispose();
      editor.dispose();
      editorRef.current = null;
      modelEntryRef.current = null;
      releaseProjectModel(key);
    };
  }, [props.cwd, props.environmentId, props.relativePath]);

  // Fresh reads sync into the live model without recreating the editor; a
  // dirty model keeps the user's unsaved edits (the conflict banner handles
  // divergence explicitly).
  useEffect(() => {
    const entry = modelEntryRef.current;
    if (!entry || entry.dirty) return;
    if (
      props.fileData.contents === entry.lastSavedContents &&
      props.fileData.mtimeMs === entry.lastReadMtimeMs
    ) {
      return;
    }
    resetProjectModel(
      entry,
      props.fileData.contents,
      props.fileData.mtimeMs,
      props.fileData.sizeBytes,
    );
    onDirtyChangeRef.current(entry.dirty, entry);
  }, [props.fileData.contents, props.fileData.mtimeMs, props.fileData.sizeBytes]);

  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap: props.wordWrap ? "on" : "off" });
  }, [props.wordWrap]);

  useEffect(() => {
    monaco.editor.setTheme(resolveMonacoThemeName(resolvedTheme));
  }, [resolvedTheme]);

  return <div ref={containerRef} className="project-monaco-editor" />;
}
