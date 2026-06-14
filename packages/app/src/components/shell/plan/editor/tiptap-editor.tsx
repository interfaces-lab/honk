"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useRef } from "react";

import { cn } from "~/lib/utils";

import { normalizePlanEditorMarkdown } from "./markdown";
import { createPlanEditorExtensions } from "./tiptap-extensions";

export function TipTapPlanEditor(props: {
  disabled: boolean;
  onChange: (nextMarkdown: string) => void;
  value: string;
}) {
  const syncingRef = useRef(false);
  const lastEmittedRef = useRef(normalizePlanEditorMarkdown(props.value));

  const editor = useEditor({
    content: props.value,
    contentType: "markdown",
    editable: !props.disabled,
    extensions: createPlanEditorExtensions(),
    onUpdate: ({ editor: currentEditor }) => {
      if (syncingRef.current) {
        return;
      }
      const nextMarkdown = normalizePlanEditorMarkdown(currentEditor.getMarkdown());
      lastEmittedRef.current = nextMarkdown;
      props.onChange(nextMarkdown);
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    editor.setEditable(!props.disabled);
  }, [editor, props.disabled]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const normalizedValue = normalizePlanEditorMarkdown(props.value);
    if (normalizedValue === lastEmittedRef.current) {
      return;
    }
    syncingRef.current = true;
    editor.commands.setContent(normalizedValue, { contentType: "markdown", emitUpdate: false });
    lastEmittedRef.current = normalizedValue;
    syncingRef.current = false;
  }, [editor, props.value]);

  return (
    <EditorContent
      editor={editor}
      data-plan-editor-input=""
      data-testid="plan-editor-input"
      className={cn(
        "plan-editor-prosemirror min-h-48 w-full px-1.5 py-2 text-title leading-(--honk-leading-title) text-(--honk-fg-primary) outline-none",
        props.disabled && "opacity-60",
      )}
    />
  );
}
