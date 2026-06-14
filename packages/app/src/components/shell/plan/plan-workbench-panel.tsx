"use client";

import { Button } from "@honk/honkkit/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@honk/honkkit/dialog";
import { Input } from "@honk/honkkit/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@honk/honkkit/menu";
import { ScrollArea } from "@honk/honkkit/scroll-area";
import type { EnvironmentId } from "@honk/contracts";
import type { TimestampFormat } from "@honk/contracts/settings";
import {
  IconArrowUp,
  IconCheckmark1,
  IconClipboard,
  IconDotGrid1x3Horizontal,
  IconFileDownload,
  IconFileText,
  IconLoader,
  IconPencilLine,
} from "central-icons";
import { WorkbenchIconButton } from "@honk/honkkit/workbench-button";
import { type FormEvent, useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { toastManager } from "~/app/toast";
import ChatMarkdown from "~/components/chat/markdown/chat-markdown";
import { readEnvironmentApi } from "~/environment-api";
import { formatProjectErrorDescription } from "~/lib/project-error-description";
import { cn } from "~/lib/utils";
import {
  buildProposedPlanMarkdownFilename,
  ensurePlanMarkdownPath,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
} from "~/plan/proposed-plan";
import type { ActivePlanState, LatestProposedPlanState } from "~/session-logic";
import { WorkbenchTextButton, workbenchIconButtonVariants } from "@honk/honkkit/workbench-button";
import { PlanEditor } from "./editor/plan-editor";
import { planEditorMarkdownMatches } from "./editor/markdown";

function stepStatusIcon(status: ActivePlanState["steps"][number]["status"]): React.ReactNode {
  if (status === "completed") {
    return (
      <span className="composer-plan-todo-indicator composer-plan-todo-indicator-completed border-success text-success">
        <IconCheckmark1 className="size-2" aria-hidden />
      </span>
    );
  }
  if (status === "inProgress") {
    return (
      <span className="composer-plan-todo-indicator border-primary text-primary">
        <IconLoader className="size-2 animate-spin" aria-hidden />
      </span>
    );
  }
  return <span className="composer-plan-todo-indicator composer-plan-todo-indicator-pending" />;
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
  onSaveProposedPlan?: ((nextMarkdown: string) => Promise<boolean>) | undefined;
}

export function PlanWorkbenchPanel({
  activePlan,
  activeProposedPlan,
  environmentId,
  label,
  markdownCwd,
  canImplementPlan = false,
  isImplementingPlan = false,
  onImplementPlan,
  onSaveProposedPlan,
}: PlanWorkbenchPanelProps) {
  const planMarkdown = activeProposedPlan?.planMarkdown ?? null;
  const displayedPlanMarkdown = planMarkdown ? stripDisplayedPlanMarkdown(planMarkdown) : null;
  const planTitle = planMarkdown ? proposedPlanTitle(planMarkdown) : null;
  const title = planTitle ?? label;
  const canEditPlan = planMarkdown !== null && onSaveProposedPlan !== undefined;
  const [editingPlan, setEditingPlan] = useState(false);
  const [draftPlanMarkdown, setDraftPlanMarkdown] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);

  useEffect(() => {
    setEditingPlan(false);
    setDraftPlanMarkdown("");
    setSavingPlan(false);
  }, [activeProposedPlan?.id]);

  useEffect(() => {
    if (!editingPlan && planMarkdown) {
      setDraftPlanMarkdown(planMarkdown);
    }
  }, [editingPlan, planMarkdown]);

  const planDirty =
    planMarkdown !== null && !planEditorMarkdownMatches(draftPlanMarkdown, planMarkdown);

  const startEditingPlan = (): void => {
    if (!planMarkdown) {
      return;
    }
    setDraftPlanMarkdown(planMarkdown);
    setEditingPlan(true);
  };

  const cancelEditingPlan = (): void => {
    if (planMarkdown) {
      setDraftPlanMarkdown(planMarkdown);
    }
    setEditingPlan(false);
  };

  const saveEditingPlan = async (): Promise<void> => {
    if (!onSaveProposedPlan || !planDirty || savingPlan) {
      return;
    }
    setSavingPlan(true);
    try {
      const saved = await onSaveProposedPlan(draftPlanMarkdown);
      if (saved) {
        setEditingPlan(false);
      }
    } finally {
      setSavingPlan(false);
    }
  };

  return (
    <div className="plan-tab-content min-h-0 min-w-0 flex-1 text-title">
      <div className="plan-tab-header no-drag flex h-(--honk-workbench-chrome-row-height) min-h-(--honk-workbench-chrome-row-height) shrink-0 items-center justify-between gap-(--honk-workbench-chrome-action-gap) border-b border-(--honk-stroke-tertiary) px-(--honk-workbench-chrome-padding-inline)">
        <div className="flex min-w-0 items-center gap-(--honk-workbench-text-control-gap)">
          <IconFileText className="size-4 shrink-0 text-(--honk-fg-secondary)" aria-hidden />
          <span className="min-w-0 truncate text-detail font-medium text-(--honk-fg-primary)">
            {title}
          </span>
        </div>

        {planMarkdown ? (
          <div className="plan-breadcrumb-controls breadcrumbs-extra-actions flex shrink-0 items-center gap-(--honk-workbench-chrome-action-gap)">
            {canEditPlan && !editingPlan ? (
              <WorkbenchIconButton
                aria-label="Edit plan"
                chrome="panel"
                title="Edit plan"
                onClick={startEditingPlan}
              >
                <IconPencilLine className="size-4" aria-hidden />
              </WorkbenchIconButton>
            ) : null}
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
                className="breadcrumbs-action-btn plan-build-button bg-(--honk-bg-yellow-primary) text-title leading-(--honk-leading-title) text-(--vscode-editor-background) shadow-none hover:bg-[color-mix(in_srgb,var(--honk-bg-yellow-primary)_80%,var(--honk-bg-yellow-secondary))] disabled:bg-honk-bg-tertiary disabled:text-honk-fg-quaternary/45 [&_svg]:text-(--vscode-editor-background)"
              >
                {isImplementingPlan ? (
                  <IconLoader className="size-4 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <IconArrowUp className="size-4 shrink-0" aria-hidden />
                )}
                <span>{isImplementingPlan ? "Building" : "Build"}</span>
              </WorkbenchTextButton>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="plan-tab-editor-region min-h-0 flex-1">
        <ScrollArea className="plan-tab-scroll min-h-0 flex-1" scrollFade>
          <div className="composer-plan-container">
            <div className="composer-plan-content mx-auto flex w-full max-w-[840px] flex-col px-3 py-3">
              {planMarkdown ? (
                editingPlan ? (
                  <PlanEditor
                    value={draftPlanMarkdown}
                    onChange={setDraftPlanMarkdown}
                    onSave={() => {
                      void saveEditingPlan();
                    }}
                    onCancel={cancelEditingPlan}
                    dirty={planDirty}
                    disabled={savingPlan}
                    markdownCwd={markdownCwd}
                  />
                ) : (
                  <div className="composer-plan-markdown-container mb-4 px-1.5">
                    <ChatMarkdown
                      text={displayedPlanMarkdown ?? ""}
                      cwd={markdownCwd}
                      isStreaming={false}
                      className="chat-markdown--plan-panel"
                    />
                  </div>
                )
              ) : null}

              {activePlan ? (
                <section className="composer-plan-todos mt-2 border-t border-(--vscode-widget-border) pt-3">
                  {activePlan.explanation ? (
                    <p className="mb-3 px-1.5 text-title leading-(--honk-leading-title) text-(--honk-fg-secondary)">
                      {activePlan.explanation}
                    </p>
                  ) : null}
                  <div className="composer-plan-section-header mb-3 flex items-center gap-2 px-1.5">
                    <h2 className="composer-plan-section-title m-0 text-title leading-(--honk-leading-title) font-semibold text-(--honk-fg-primary)">
                      Tasks
                    </h2>
                    <span className="composer-plan-section-count text-detail leading-(--honk-leading-detail) text-(--honk-fg-secondary) opacity-70">
                      {activePlan.steps.length}
                    </span>
                  </div>
                  <div className="grid gap-2 px-1.5">
                    {activePlan.steps.map((step) => (
                      <div key={step.step} className="flex min-w-0 items-start gap-2">
                        <div className="mt-0.5 shrink-0">{stepStatusIcon(step.status)}</div>
                        <p
                          className={cn(
                            "m-0 min-w-0 text-title leading-(--honk-leading-title)",
                            step.status === "completed"
                              ? "text-(--honk-fg-tertiary) line-through decoration-honk-fg-quaternary"
                              : step.status === "inProgress"
                                ? "text-(--honk-fg-primary)"
                                : "text-(--honk-fg-secondary)",
                          )}
                        >
                          {step.step}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {!activePlan && !planMarkdown ? (
                <div className="composer-plan-empty-state flex min-h-0 flex-1 items-center justify-center px-4 py-10 text-center">
                  <p className="text-title leading-(--honk-leading-title) text-(--honk-fg-tertiary)">
                    No plan data available.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
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
    const trimmedPath = ensurePlanMarkdownPath(relativePath);
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

    setRelativePath(trimmedPath);

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
      const description = formatProjectErrorDescription(error, "An error occurred.");
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
          <IconDotGrid1x3Horizontal className="size-4" aria-hidden />
        </MenuTrigger>
        <MenuPopup align="end" side="bottom" variant="workbench">
          <MenuItem variant="workbench" onClick={() => void copyPlan()}>
            <IconClipboard className="size-4" aria-hidden />
            <span>Copy markdown</span>
          </MenuItem>
          <MenuItem variant="workbench" onClick={downloadPlan}>
            <IconFileDownload className="size-4" aria-hidden />
            <span>Download markdown</span>
          </MenuItem>
          <MenuItem
            variant="workbench"
            onClick={() => {
              setRelativePath(buildProposedPlanMarkdownFilename(props.planMarkdown));
              setSaveError(null);
              setSaveDialogOpen(true);
            }}
          >
            <IconFileText className="size-4" aria-hidden />
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
              <label className="grid gap-1.5 text-sm text-honk-fg-secondary">
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
