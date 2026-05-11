import { memo, useState, useId } from "react";
import type { EnvironmentId } from "@multi/contracts";
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
} from "../../../proposed-plan";
import ChatMarkdown from "../markdown/chat-markdown";
import { IconDotGrid1x3Horizontal } from "central-icons";
import { Button } from "@multi/ui/button";
import { Input } from "@multi/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@multi/ui/menu";
import { cn } from "~/lib/utils";
import { Badge } from "@multi/ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@multi/ui/dialog";
import { toastManager } from "~/app/toast";
import { readEnvironmentApi } from "~/environment-api";
import { useCopyToClipboard } from "~/hooks/use-copy-to-clipboard";

export const ProposedPlanCard = memo(function ProposedPlanCard({
  planMarkdown,
  environmentId,
  cwd,
  projectRoot,
}: {
  planMarkdown: string;
  environmentId: EnvironmentId;
  cwd: string | undefined;
  projectRoot: string | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [savePath, setSavePath] = useState("");
  const [isSavingToProject, setIsSavingToProject] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not copy plan",
        description: error instanceof Error ? error.message : "An error occurred while copying.",
      });
    },
  });
  const savePathInputId = useId();
  const title = proposedPlanTitle(planMarkdown) ?? "Proposed plan";
  const lineCount = planMarkdown.split("\n").length;
  const canCollapse = planMarkdown.length > 900 || lineCount > 20;
  const displayedPlanMarkdown = stripDisplayedPlanMarkdown(planMarkdown);
  const collapsedPreview = canCollapse
    ? buildCollapsedProposedPlanPreviewMarkdown(planMarkdown, { maxLines: 10 })
    : null;
  const downloadFilename = buildProposedPlanMarkdownFilename(planMarkdown);
  const saveContents = normalizePlanMarkdownForExport(planMarkdown);

  const handleDownload = () => {
    downloadPlanAsTextFile(downloadFilename, saveContents);
  };

  const handleCopyPlan = () => {
    copyToClipboard(saveContents);
  };

  const openSaveDialog = () => {
    if (!projectRoot) {
      toastManager.add({
        type: "error",
        title: "Project path is unavailable",
        description: "This thread does not have a project path to save into.",
      });
      return;
    }
    setSavePath((existing) => (existing.length > 0 ? existing : downloadFilename));
    setIsSaveDialogOpen(true);
  };

  const handleSaveToProject = () => {
    const api = readEnvironmentApi(environmentId);
    const relativePath = savePath.trim();
    if (!api || !projectRoot) {
      return;
    }
    if (!relativePath) {
      toastManager.add({
        type: "warning",
        title: "Enter a project path",
      });
      return;
    }

    setIsSavingToProject(true);
    void api.projects
      .writeFile({
        cwd: projectRoot,
        relativePath,
        contents: saveContents,
      })
      .then((result) => {
        setIsSaveDialogOpen(false);
        toastManager.add({
          type: "success",
          title: "Plan saved to project",
          description: result.relativePath,
        });
      })
      .catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not save plan",
          description: error instanceof Error ? error.message : "An error occurred while saving.",
        });
      })
      .then(
        () => {
          setIsSavingToProject(false);
        },
        () => {
          setIsSavingToProject(false);
        },
      );
  };

  return (
    <div className="rounded-[24px] border border-border/80 bg-card/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary">Plan</Badge>
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
        </div>
        <Menu>
          <MenuTrigger
            render={<Button aria-label="Plan actions" size="icon-xs" variant="outline" />}
          >
            <IconDotGrid1x3Horizontal aria-hidden="true" className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={handleCopyPlan}>
              {isCopied ? "Copied!" : "Copy to clipboard"}
            </MenuItem>
            <MenuItem onClick={handleDownload}>Download as markdown</MenuItem>
            <MenuItem onClick={openSaveDialog} disabled={!projectRoot || isSavingToProject}>
              Save to project
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="mt-4">
        <div className={cn("relative", canCollapse && !expanded && "max-h-104 overflow-hidden")}>
          {canCollapse && !expanded ? (
            <ChatMarkdown text={collapsedPreview ?? ""} cwd={cwd} isStreaming={false} />
          ) : (
            <ChatMarkdown text={displayedPlanMarkdown} cwd={cwd} isStreaming={false} />
          )}
          {canCollapse && !expanded ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-card/95 via-card/80 to-transparent" />
          ) : null}
        </div>
        {canCollapse ? (
          <div className="mt-4 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              data-scroll-anchor-ignore
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Collapse plan" : "Expand plan"}
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog
        open={isSaveDialogOpen}
        onOpenChange={(open) => {
          if (!isSavingToProject) {
            setIsSaveDialogOpen(open);
          }
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Save plan to project</DialogTitle>
            <DialogDescription>
              Enter a path relative to <code>{projectRoot ?? "the project"}</code>.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <label htmlFor={savePathInputId} className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Project path</span>
              <Input
                id={savePathInputId}
                value={savePath}
                onChange={(event) => setSavePath(event.target.value)}
                placeholder={downloadFilename}
                spellCheck={false}
                disabled={isSavingToProject}
              />
            </label>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSaveDialogOpen(false)}
              disabled={isSavingToProject}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSaveToProject()}
              disabled={isSavingToProject}
            >
              {isSavingToProject ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
});
