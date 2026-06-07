import { Button } from "@multi/multikit/button";
import { Textarea } from "@multi/multikit/textarea";
import { IconCheckmark1, IconCrossSmall, IconPencilLine } from "central-icons";
import { useState, type FormEvent } from "react";

import type { ProposedPlan } from "../../../types";
import ChatMarkdown from "../markdown/chat-markdown";
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
        className="flex w-full min-w-0 flex-col overflow-hidden rounded-multi-card border border-multi-stroke-secondary bg-multi-bg-secondary text-conversation text-multi-fg-primary shadow-multi-card"
      >
        <div className="flex min-w-0 items-center gap-2 border-b border-multi-stroke-tertiary px-3 py-2">
          <div className="min-w-0 flex-1 truncate text-title font-medium">{title}</div>
          {canEdit && !editing ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-detail"
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
          <form onSubmit={submit} className="flex min-w-0 flex-col gap-2 p-3">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              className="bg-multi-bg-primary"
              controlClassName="min-h-48 resize-y px-2 py-2 font-multi-mono text-detail leading-relaxed"
              data-proposed-plan-editor=""
              aria-label="Edit plan"
              spellCheck={false}
            />
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
          <div className="min-w-0 px-3 py-2">
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
