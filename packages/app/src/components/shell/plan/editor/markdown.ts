import { normalizePlanMarkdownForExport } from "~/plan/proposed-plan";

export function normalizePlanEditorMarkdown(markdown: string): string {
  return normalizePlanMarkdownForExport(markdown);
}

export function planEditorMarkdownMatches(left: string, right: string): boolean {
  return normalizePlanEditorMarkdown(left) === normalizePlanEditorMarkdown(right);
}
