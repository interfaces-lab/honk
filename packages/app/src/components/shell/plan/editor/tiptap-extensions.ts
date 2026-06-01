import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

export function createPlanEditorExtensions() {
  return [StarterKit, Markdown];
}
