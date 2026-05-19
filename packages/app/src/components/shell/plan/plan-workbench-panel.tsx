"use client";

import { Button } from "@multi/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@multi/ui/dialog";
import { Input } from "@multi/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@multi/ui/menu";
import type { EnvironmentId } from "@multi/contracts";
import type { TimestampFormat } from "@multi/contracts/settings";
import {
  IconArrowUp,
  IconCheckmark1,
  IconClipboard,
  IconDotGrid1x3Horizontal,
  IconFileDownload,
  IconFileText,
  IconLoader,
} from "central-icons";
import { memo, type FormEvent, useId, useState } from "react";
import { toast } from "sonner";

import { toastManager } from "~/app/toast";
import ChatMarkdown from "~/components/chat/markdown/chat-markdown";
import { readEnvironmentApi } from "~/environment-api";
import { cn } from "~/lib/utils";
import {
  buildProposedPlanMarkdownFilename,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
} from "~/plan/proposed-plan";
import type { ActivePlanState, LatestProposedPlanState } from "~/session-logic";
import { formatTimestamp } from "~/lib/timestamp-format";
import { WorkbenchChromeRow } from "../shell/workbench-chrome-row";
import { workbenchIconButtonVariants, WorkbenchTextButton } from "../shell/workbench-icon-button";

function stepStatusIcon(status: ActivePlanState["steps"][number]["status"]): React.ReactNode {
  if (status === "completed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
        <IconCheckmark1 className="size-3" aria-hidden />
      </span>
    );
  }
  if (status === "inProgress") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
        <IconLoader className="size-3 animate-spin" aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-multi-stroke-tertiary bg-multi-bg-quinary">
      <span className="size-1.5 rounded-full bg-multi-fg-quaternary" />
    </span>
  );
}

export interface PlanWorkbenchPanelProps {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  environmentId: EnvironmentId | null;
  label: "Plan" | "Tasks";
  markdownCwd: string | undefined;
  timestampFormat: TimestampFormat;
  canImplementPlan?: boolean | undefined;
  isImplementingPlan?: boolean | undefined;
  onImplementPlan?: (() => void) | undefined;
}

export const PlanWorkbenchPanel = memo(function PlanWorkbenchPanel({
  activePlan,
  activeProposedPlan,
  environmentId,
  label,
  markdownCwd,
  timestampFormat,
  canImplementPlan = false,
  isImplementingPlan = false,
  onImplementPlan,
}: PlanWorkbenchPanelProps) {
  const planMarkdown = activeProposedPlan?.planMarkdown ?? null;
  const displayedPlanMarkdown = planMarkdown ? stripDisplayedPlanMarkdown(planMarkdown) : null;
  const planTitle = planMarkdown ? proposedPlanTitle(planMarkdown) : null;
  const timestamp = activePlan?.createdAt ?? activeProposedPlan?.updatedAt ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <WorkbenchChromeRow
        variant="panel"
        gap="relaxed"
        trailing={
          planMarkdown ? (
            <div className="flex shrink-0 items-center gap-(--multi-workbench-chrome-action-gap)">
              <PlanActions
                key={activeProposedPlan?.id ?? planMarkdown}
                environmentId={environmentId}
                markdownCwd={markdownCwd}
                planMarkdown={planMarkdown}
              />
              {onImplementPlan ? (
                <WorkbenchTextButton
                  onClick={onImplementPlan}
                  title="Build plan"
                  tone="primary"
                  disabled={!canImplementPlan || isImplementingPlan}
                >
                  {isImplementingPlan ? (
                    <IconLoader className="size-3.5 shrink-0 animate-spin" aria-hidden />
                  ) : (
                    <IconArrowUp className="size-3.5 shrink-0" aria-hidden />
                  )}
                  <span>{isImplementingPlan ? "Building" : "Build"}</span>
                </WorkbenchTextButton>
              ) : null}
            </div>
          ) : null
        }
      >
        <span className="inline-flex h-(--multi-workbench-action-size) shrink-0 items-center rounded-multi-control bg-multi-bg-tertiary px-1.5 text-caption font-semibold text-multi-fg-secondary uppercase">
          {label}
        </span>
        {timestamp ? (
          <span className="min-w-0 truncate text-detail text-multi-fg-tertiary">
            {formatTimestamp(timestamp, timestampFormat)}
          </span>
        ) : null}
      </WorkbenchChromeRow>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        {activePlan ? (
          <section className="grid gap-3">
            {activePlan.explanation ? (
              <p className="text-body text-multi-fg-secondary">{activePlan.explanation}</p>
            ) : null}
            <div className="grid gap-1.5">
              <h2 className="text-caption font-semibold tracking-wide text-multi-fg-tertiary uppercase">
                Tasks
              </h2>
              <div className="grid gap-1">
                {activePlan.steps.map((step) => (
                  <div
                    key={step.step}
                    className={cn(
                      "flex min-w-0 items-start gap-2.5 rounded-multi-control px-2.5 py-2 transition-colors duration-150 ease-out",
                      step.status === "inProgress" && "bg-blue-500/5",
                      step.status === "completed" && "bg-emerald-500/5",
                    )}
                  >
                    <div className="mt-0.5 shrink-0">{stepStatusIcon(step.status)}</div>
                    <p
                      className={cn(
                        "min-w-0 text-body",
                        step.status === "completed"
                          ? "text-multi-fg-tertiary line-through decoration-multi-fg-quaternary"
                          : step.status === "inProgress"
                            ? "text-multi-fg-primary"
                            : "text-multi-fg-secondary",
                      )}
                    >
                      {step.step}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {planMarkdown ? (
          <section className="grid gap-3 border-t border-multi-stroke-tertiary pt-4 first:border-t-0 first:pt-0">
            <h2 className="text-caption font-semibold tracking-wide text-multi-fg-tertiary uppercase">
              {planTitle ?? "Proposed Plan"}
            </h2>
            <div className="min-w-0 text-body text-multi-fg-primary">
              <ChatMarkdown
                text={displayedPlanMarkdown ?? ""}
                cwd={markdownCwd}
                isStreaming={false}
              />
            </div>
          </section>
        ) : null}

        {!activePlan && !planMarkdown ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-8 text-center">
            <p className="text-body text-multi-fg-tertiary">No plan data available.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
});

function readRecordField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

function readNonEmptyStringField(value: unknown, key: string): string | null {
  const field = readRecordField(value, key);
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : null;
}

function formatProjectWriteErrorDescription(error: unknown): string {
  const message =
    readNonEmptyStringField(error, "message") ??
    (error instanceof Error && error.message.trim().length > 0 ? error.message.trim() : null);
  const cause = readRecordField(error, "cause");
  const detail = readNonEmptyStringField(cause, "detail");
  const operation = readNonEmptyStringField(cause, "operation");
  const cwd = readNonEmptyStringField(cause, "cwd");
  const relativePath = readNonEmptyStringField(cause, "relativePath");
  const lines = [message ?? "An error occurred."];

  if (detail && detail !== message) {
    lines.push(detail);
  }
  if (operation) {
    lines.push(`Operation: ${operation}`);
  }
  if (cwd) {
    lines.push(`Project: ${cwd}`);
  }
  if (relativePath) {
    lines.push(`Path: ${relativePath}`);
  }

  return lines.join("\n");
}

function PlanActions(props: {
  environmentId: EnvironmentId | null;
  markdownCwd: string | undefined;
  planMarkdown: string;
}) {
  const formId = useId();
  const contents = normalizePlanMarkdownForExport(props.planMarkdown);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [relativePath, setRelativePath] = useState(() =>
    buildProposedPlanMarkdownFilename(props.planMarkdown),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const copyPlan = async (): Promise<void> => {
    if (!navigator.clipboard?.writeText) {
      toast.error("Clipboard API unavailable.");
      return;
    }

    try {
      await navigator.clipboard.writeText(contents);
      toast.success("Plan copied.");
    } catch (error) {
      toast.error("Could not copy plan.", {
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };

  const downloadPlan = (): void => {
    const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildProposedPlanMarkdownFilename(props.planMarkdown);
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const savePlan = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmedPath = relativePath.trim();
    if (!props.markdownCwd) {
      toast.error("No project path is available.");
      return;
    }
    if (!props.environmentId) {
      toast.error("Environment API unavailable.");
      return;
    }
    if (!trimmedPath) {
      toast.error("Enter a project-relative path.");
      return;
    }

    const api = readEnvironmentApi(props.environmentId);
    if (!api) {
      toast.error("Environment API unavailable.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await api.projects.writeFile({
        cwd: props.markdownCwd,
        relativePath: trimmedPath,
        contents,
      });
      toast.success(`Saved ${result.relativePath}.`);
      setSaveDialogOpen(false);
    } catch (error) {
      const description = formatProjectWriteErrorDescription(error);
      setSaveError(description);
      toastManager.add({
        type: "error",
        title: "Could not save plan",
        description,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Menu>
        <MenuTrigger
          type="button"
          aria-label="Plan actions"
          className={workbenchIconButtonVariants({ chrome: "panel" })}
        >
          <IconDotGrid1x3Horizontal className="size-3.5" aria-hidden />
        </MenuTrigger>
        <MenuPopup align="end" side="bottom" variant="workbench">
          <MenuItem variant="workbench" onClick={() => void copyPlan()}>
            <IconClipboard className="size-3.5" aria-hidden />
            <span>Copy markdown</span>
          </MenuItem>
          <MenuItem variant="workbench" onClick={downloadPlan}>
            <IconFileDownload className="size-3.5" aria-hidden />
            <span>Download markdown</span>
          </MenuItem>
          <MenuItem
            variant="workbench"
            onClick={() => {
              setSaveError(null);
              setSaveDialogOpen(true);
            }}
          >
            <IconFileText className="size-3.5" aria-hidden />
            <span>Save to project</span>
          </MenuItem>
        </MenuPopup>
      </Menu>

      <Dialog
        open={saveDialogOpen}
        onOpenChange={(open) => {
          setSaveDialogOpen(open);
          if (!open) {
            setSaveError(null);
          }
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save plan</DialogTitle>
            <DialogDescription>
              Enter a path relative to {props.markdownCwd ?? "the project"}.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={formId} className="space-y-2" onSubmit={savePlan}>
              <label className="grid gap-1.5 text-sm text-multi-fg-secondary">
                <span>Path</span>
                <Input
                  autoFocus
                  value={relativePath}
                  onChange={(event) => {
                    setRelativePath(event.target.value);
                    setSaveError(null);
                  }}
                  placeholder="docs/plan.md"
                />
              </label>
              {saveError ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2 text-detail text-destructive"
                >
                  <p className="font-medium">Could not save plan.</p>
                  <p className="whitespace-pre-wrap text-destructive/85">{saveError}</p>
                </div>
              ) : null}
            </form>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button form={formId} type="submit" disabled={isSaving}>
              {isSaving ? "Saving" : "Save"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
