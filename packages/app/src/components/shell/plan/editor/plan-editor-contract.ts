export interface PlanEditorProps {
  value: string;
  onChange: (nextMarkdown: string) => void;
  onSave: () => void;
  onCancel: () => void;
  dirty: boolean;
  disabled: boolean;
  markdownCwd?: string | undefined;
}
