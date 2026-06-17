import { Button } from "@honk/honkkit/button";
import { IconCheckmark1, IconCrossSmall, IconPencilLine } from "central-icons";
import { useState, type FormEvent } from "react";

import type { ProposedPlan } from "../../../types";
import ChatMarkdown from "../markdown/chat-markdown";
import { TipTapPlanEditor } from "~/components/shell/plan/editor/tiptap-editor";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "~/plan/proposed-plan";

export function ProposedPlanMessage({
  canEdit,
  markdownCwd,
  onSave,
  proposedPlan,
}: {
  canEdit: boolean;
  markdownCwd: string | undefined;
  onSave: ((proposedPlan: ProposedPlan, nextMarkdown: string) => Promise<boolean>) | undefined;
  proposedPlan: ProposedPlan;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState("");
  const title = proposedPlanTitle(proposedPlan.planMarkdown) ?? "Plan";
  const displayedMarkdown = stripDisplayedPlanMarkdown(proposedPlan.planMarkdown);
  const canSave = canEdit && onSave !== undefined && draft.trim().length > 0 && !saving;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave || !onSave) {
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave(proposedPlan, draft);
      if (saved) {
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="box-border flex w-full min-w-0 justify-start">
      <div
        data-proposed-plan-message=""
        className="group/proposed-plan flex w-full min-w-0 flex-col text-conversation text-honk-fg-primary"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-title font-semibold">{title}</div>
          {canEdit && !editing ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-detail text-honk-fg-tertiary opacity-0 transition-opacity duration-100 group-hover/proposed-plan:opacity-100 hover:text-honk-fg-secondary focus-visible:opacity-100"
              onClick={() => {
                setDraft(proposedPlan.planMarkdown);
                setEditing(true);
              }}
            >
              <IconPencilLine className="size-3.5" aria-hidden />
              <span>Edit</span>
            </Button>
          ) : null}
        </div>
        {editing ? (
          <form onSubmit={submit} className="flex min-w-0 flex-col gap-2 pt-2">
            <div
              className="min-w-0 rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary px-1 py-1"
              data-proposed-plan-editor=""
            >
              <TipTapPlanEditor
                ariaLabel="Edit proposed plan"
                disabled={saving}
                onChange={setDraft}
                value={draft}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-detail"
                disabled={saving}
                onClick={() => {
                  setDraft(proposedPlan.planMarkdown);
                  setEditing(false);
                }}
              >
                <IconCrossSmall className="size-3.5" aria-hidden />
                <span>Cancel</span>
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-7 gap-1 px-2 text-detail"
                disabled={!canSave}
              >
                <IconCheckmark1 className="size-3.5" aria-hidden />
                <span>{saving ? "Saving" : "Save"}</span>
              </Button>
            </div>
          </form>
        ) : (
          <div className="min-w-0 pt-1.5">
            <ChatMarkdown
              text={displayedMarkdown}
              cwd={markdownCwd}
              isStreaming={false}
              className="chat-markdown--plan-panel"
            />
          </div>
        )}
      </div>
    </div>
  );
}
