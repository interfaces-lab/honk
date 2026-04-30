"use client";

import type { GitFileState } from "~/lib/ui-session-types";
import {
  IconArrowRotateCounterClockwise,
  IconBarsThree,
  IconChevronBottom,
  IconChevronRight,
  IconClipboard,
  IconDotGrid1x3Horizontal,
  IconBranch,
  IconSplit,
} from "central-icons";
import { memo, type MouseEvent, useCallback, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@multi/ui/badge";
import { Button } from "@multi/ui/button";
import { Collapsible } from "@multi/ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@multi/ui/dialog";
import { isElectron } from "~/env";
import {
  type DiffRow,
  type GitPanelModel,
  useDiffStylePreference,
} from "~/hooks/use-environment-git";
import { useGitViewed } from "~/hooks/use-git-viewed-state";
import { cn } from "~/lib/utils";
import { VsFileIcon } from "~/lib/vscode-file-icon";
import { BranchCommitDialog, CommitDialog } from "./commit-dialog";
import { DiffViewer } from "./diff-viewer";

const kindVariant: Partial<
  Record<GitFileState, "warning" | "success" | "destructive" | "secondary" | "outline">
> = {
  untracked: "warning",
  added: "success",
  deleted: "destructive",
  renamed: "secondary",
  copied: "secondary",
  ignored: "outline",
  conflict: "destructive",
};

const kindLabel: Partial<Record<GitFileState, string>> = {
  untracked: "untracked",
  added: "new",
  deleted: "deleted",
  renamed: "renamed",
  copied: "copied",
  ignored: "ignored",
  conflict: "conflict",
};

function KindBadge(props: { state: GitFileState }) {
  const variant = kindVariant[props.state];
  if (!variant) return null;
  return (
    <Badge variant={variant} className="px-1 py-0 text-[11px] leading-4 font-medium">
      {kindLabel[props.state] ?? props.state}
    </Badge>
  );
}

function splitPath(path: string) {
  const idx = path.lastIndexOf("/");
  if (idx < 0) return { prefix: "", name: path };
  return { prefix: path.slice(0, idx + 1), name: path.slice(idx + 1) };
}

export function GitPanel(props: { git: GitPanelModel }) {
  const git = props.git;

  if (!isElectron) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <p className="text-body/[1.4] font-medium text-foreground/85">Source control</p>
        <p className="max-w-[18rem] text-detail/[1.45] text-muted-foreground/72">
          Git status and diffs are available in the Multi desktop app.
        </p>
      </div>
    );
  }

  switch (git.view.kind) {
    case "idle":
    case "loading":
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-3">
          <div className="h-3 w-24 animate-pulse rounded bg-muted/40" />
          <div className="h-3 w-full animate-pulse rounded bg-muted/30" />
          <div className="h-3 w-full animate-pulse rounded bg-muted/30" />
        </div>
      );
    case "error":
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <p className="text-body/[1.4] font-medium text-destructive/90">Git error</p>
          <p className="max-w-[20rem] text-detail/[1.45] text-muted-foreground/80">
            {git.view.message}
          </p>
        </div>
      );
    case "no-repo":
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
          <div className="space-y-1 px-4 py-3">
            <p className="text-body/[1.4] font-medium text-foreground/85">No repository</p>
            <p className="max-w-[18rem] text-detail/[1.45] text-muted-foreground/72">
              Initialize Git in this workspace to track changes and review diffs.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void git
                .init()
                .catch((error: unknown) =>
                  toast.error(error instanceof Error ? error.message : String(error)),
                );
            }}
            className="rounded-multi-control border border-multi-border/60 bg-multi-active/40 px-3 py-2 text-body/[1.2] font-medium text-foreground transition-colors hover:bg-multi-hover"
          >
            Init Git
          </button>
        </div>
      );
    case "clean":
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-center">
          <p className="text-body/[1.4] font-medium text-foreground/85">Working tree clean</p>
          <p className="max-w-[18rem] text-detail/[1.45] text-muted-foreground/72">
            No staged or unstaged changes in this repository.
          </p>
        </div>
      );
    case "changed":
      return <GitPanelInner git={git} />;
  }
}

function GitPanelInner(props: { git: GitPanelModel }) {
  const git = props.git;
  const files = git.rows;
  const viewed = useGitViewed(git.cwd);
  const [diffStyle, setDiffStyle] = useDiffStylePreference();
  const [pending, setPending] = useState<DiffRow | null>(null);
  const [discardAllPending, setDiscardAllPending] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  const confirmDiscard = useCallback(() => {
    if (!pending) return;
    void git
      .discard([pending.path])
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      );
    setPending(null);
  }, [git, pending]);

  const confirmDiscardAll = useCallback(() => {
    const allPaths = files.map((f) => f.path);
    void git
      .discard(allPaths)
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      );
    setDiscardAllPending(false);
  }, [git, files]);

  const handleCommitAndPush = useCallback(() => {
    setCommitOpen(true);
  }, []);

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <LocalBranchBar
        branch={git.branch}
        onCommitAndPush={handleCommitAndPush}
        onBranchCommit={() => setBranchOpen(true)}
        menuOpen={headerMenuOpen}
        onMenuOpen={setHeaderMenuOpen}
      />
      <ChangesHeader
        count={files.length}
        add={git.totalAdd}
        del={git.totalDel}
        onExpandAll={git.expandAll}
        onCollapseAll={git.collapseAll}
        diffStyle={diffStyle}
        onDiffStyle={setDiffStyle}
        onDiscardAll={() => setDiscardAllPending(true)}
        onRefresh={() => void git.refresh()}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 pb-3 pt-1 [scrollbar-gutter:stable]">
        <div className="flex flex-col gap-1">
          {files.map((file) => (
            <GitFileCard
              key={file.id}
              file={file}
              expanded={git.expandedIds.has(file.id)}
              onToggle={(open) => git.toggleExpand(file.id, open)}
              diff={git.diffsByPath.get(file.path) ?? null}
              patch={git.patchesByPath.get(file.path) ?? null}
              loading={git.diffLoadingByPath.has(file.path)}
              error={git.diffErrorByPath.get(file.path) ?? null}
              diffStyle={diffStyle}
              viewed={viewed.isViewed(file.path)}
              onToggleViewed={() => viewed.toggleViewed(file.path)}
              onRevert={() => setPending(file)}
            />
          ))}
        </div>
      </div>
      <DiscardDialog
        open={pending !== null}
        path={pending?.path ?? ""}
        onConfirm={confirmDiscard}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      />
      <DiscardAllDialog
        open={discardAllPending}
        count={files.length}
        onConfirm={confirmDiscardAll}
        onOpenChange={setDiscardAllPending}
      />
      <CommitDialog open={commitOpen} onOpenChange={setCommitOpen} onCommit={git.runCommit} />
      <BranchCommitDialog
        open={branchOpen}
        onOpenChange={setBranchOpen}
        onCommit={git.runBranchCommit}
      />
    </div>
  );
}

function LocalBranchBar(props: {
  branch: string | null;
  onCommitAndPush: () => void;
  onBranchCommit: () => void;
  menuOpen: boolean;
  onMenuOpen: (open: boolean) => void;
}) {
  const copyBranch = () => {
    if (!props.branch) return;
    void navigator.clipboard.writeText(props.branch);
    toast.success("Branch copied");
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-multi-stroke-tertiary px-3">
      <span className="text-detail font-medium text-muted-foreground/70">Local</span>
      <button
        type="button"
        onClick={copyBranch}
        className="flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-detail font-medium text-foreground/90 transition-colors hover:bg-multi-hover hover:text-foreground"
        title="Copy branch name"
      >
        <IconBranch className="size-3 shrink-0 text-muted-foreground/60" />
        <span className="truncate font-mono">{props.branch ?? "detached"}</span>
      </button>
      <div className="flex-1" />
      <Button type="button" size="sm" onClick={props.onCommitAndPush}>
        Commit & Push
      </Button>
      <div className="relative">
        <button
          type="button"
          onClick={() => props.onMenuOpen(!props.menuOpen)}
          className="flex size-6 items-center justify-center rounded-multi-control text-muted-foreground/70 hover:bg-multi-hover hover:text-foreground"
          aria-label="More options"
        >
          <IconDotGrid1x3Horizontal className="size-3.5" />
        </button>
        {props.menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => props.onMenuOpen(false)} />
            <div className="absolute top-full right-0 z-50 mt-1 min-w-[160px] rounded-multi-card border border-multi-stroke bg-multi-bubble p-1 text-detail shadow-multi-popup backdrop-blur-xl">
              <MenuItem
                label="Create Branch & Commit..."
                onClick={() => {
                  props.onBranchCommit();
                  props.onMenuOpen(false);
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChangesHeader(props: {
  count: number;
  add: number;
  del: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  diffStyle: "unified" | "split";
  onDiffStyle: (next: "unified" | "split") => void;
  onDiscardAll: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-multi-stroke-tertiary px-3.5">
      <span className="text-detail tabular-nums text-foreground/80">
        {props.count} Uncommitted Change{props.count === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-1 text-detail tabular-nums">
        {props.add > 0 && <span className="font-medium text-success-foreground">+{props.add}</span>}
        {props.del > 0 && (
          <span className="font-medium text-destructive-foreground">-{props.del}</span>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={props.onDiscardAll}
          className="text-detail text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          Discard All Changes
        </button>
        <DiffStyleToggle style={props.diffStyle} onChange={props.onDiffStyle} />
        <button
          type="button"
          onClick={props.onExpandAll}
          className="flex size-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-multi-hover hover:text-foreground"
          title="Expand all"
        >
          <IconChevronBottom className="size-3" />
        </button>
        <button
          type="button"
          onClick={props.onCollapseAll}
          className="flex size-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-multi-hover hover:text-foreground"
          title="Collapse all"
        >
          <IconChevronRight className="size-3" />
        </button>
      </div>
    </div>
  );
}

function DiffStyleToggle(props: {
  style: "unified" | "split";
  onChange: (next: "unified" | "split") => void;
}) {
  return (
    <div className="flex shrink-0 items-center rounded-multi-control border border-multi-border/45 bg-multi-hover/14 p-0.5">
      <button
        type="button"
        onClick={() => props.onChange("unified")}
        className={cn(
          "flex size-5 items-center justify-center rounded-multi-control transition-colors",
          props.style === "unified"
            ? "bg-multi-active/60 text-foreground"
            : "text-muted-foreground/70 hover:bg-multi-hover hover:text-foreground",
        )}
        aria-label="Unified diff"
        aria-pressed={props.style === "unified"}
      >
        <IconBarsThree className="size-3" />
      </button>
      <button
        type="button"
        onClick={() => props.onChange("split")}
        className={cn(
          "flex size-5 items-center justify-center rounded-multi-control transition-colors",
          props.style === "split"
            ? "bg-multi-active/60 text-foreground"
            : "text-muted-foreground/70 hover:bg-multi-hover hover:text-foreground",
        )}
        aria-label="Split diff"
        aria-pressed={props.style === "split"}
      >
        <IconSplit className="size-3" />
      </button>
    </div>
  );
}

function MenuItem(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex w-full items-center rounded-sm px-2 py-1 text-left text-foreground/82 transition-colors hover:bg-multi-active hover:text-foreground"
    >
      {props.label}
    </button>
  );
}

function DiscardAllDialog(props: {
  open: boolean;
  count: number;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Discard all changes?</DialogTitle>
          <DialogDescription>
            Revert all {props.count} file{props.count === 1 ? "" : "s"} to the last committed
            version. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              props.onConfirm();
              props.onOpenChange(false);
            }}
          >
            Discard All
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

interface CardProps {
  file: DiffRow;
  expanded: boolean;
  onToggle: (open: boolean) => void;
  diff: import("@pierre/diffs").FileDiffMetadata | null;
  patch: string | null;
  loading: boolean;
  error: string | null;
  diffStyle: "unified" | "split";
  viewed: boolean;
  onToggleViewed: () => void;
  onRevert: () => void;
}

const GitFileCard = memo(function GitFileCard(props: CardProps) {
  const { prefix, name } = splitPath(props.file.path);

  const copyPath = (e: MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(props.file.path);
    toast.success("Path copied");
  };

  return (
    <Collapsible.Root open={props.expanded} onOpenChange={props.onToggle}>
      <div className="overflow-hidden rounded-lg border border-multi-stroke bg-multi-editor">
        <Collapsible.Trigger className="flex h-7 w-full items-center gap-1.5 px-2 text-detail text-left transition-colors hover:bg-multi-hover/50">
          <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/60">
            {props.expanded ? (
              <IconChevronBottom className="size-3" />
            ) : (
              <IconChevronRight className="size-3" />
            )}
          </span>
          <VsFileIcon path={props.file.path} className="size-3.5 shrink-0" />
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            <span className="shrink-0 font-medium text-foreground/90">{name}</span>
            {prefix && (
              <span className="min-w-0 truncate text-caption text-muted-foreground/45">
                {prefix}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={copyPath}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground [div:hover>&]:opacity-100"
            aria-label="Copy path"
          >
            <IconClipboard className="size-3" />
          </button>
          <div className="flex shrink-0 items-center gap-1 tabular-nums">
            {props.file.add > 0 && (
              <span className="font-medium text-success-foreground">+{props.file.add}</span>
            )}
            {props.file.del > 0 && (
              <span className="font-medium text-destructive-foreground">-{props.file.del}</span>
            )}
          </div>
          <KindBadge state={props.file.state} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onRevert();
            }}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:bg-multi-hover hover:text-foreground"
            aria-label="Discard changes"
            title="Discard changes"
          >
            <IconArrowRotateCounterClockwise className="size-3" />
          </button>
          <input
            type="checkbox"
            checked={props.viewed}
            onChange={(e) => {
              e.stopPropagation();
              props.onToggleViewed();
            }}
            onClick={(e) => e.stopPropagation()}
            className="size-3.5 shrink-0 rounded border-multi-border/60 accent-primary"
            aria-label="Mark as viewed"
            title="Mark as viewed"
          />
        </Collapsible.Trigger>
        <Collapsible.Panel keepMounted className="overflow-hidden">
          <div className="border-t border-multi-stroke/60">
            {props.loading ? (
              <div className="flex flex-col gap-2 px-3 py-3">
                <div className="h-3 w-full max-w-[14rem] animate-pulse rounded bg-muted/35" />
                <div className="h-3 w-full animate-pulse rounded bg-muted/28" />
                <div className="h-3 w-[92%] animate-pulse rounded bg-muted/28" />
              </div>
            ) : props.error ? (
              <div className="px-3 py-3 text-detail text-destructive/90">{props.error}</div>
            ) : (
              <DiffViewer
                fileDiff={props.diff}
                filePatch={props.patch}
                path={props.file.path}
                state={props.file.state}
                prevPath={props.file.prevPath}
                diffStyle={props.diffStyle}
                className="max-h-[min(60vh,32rem)] overflow-auto"
              />
            )}
          </div>
        </Collapsible.Panel>
      </div>
    </Collapsible.Root>
  );
});

function DiscardDialog(props: {
  open: boolean;
  path: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Discard changes?</DialogTitle>
          <DialogDescription>
            Revert <span className="font-mono text-foreground/90">{props.path}</span> to the last
            committed version. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              props.onConfirm();
              props.onOpenChange(false);
            }}
          >
            Discard
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
