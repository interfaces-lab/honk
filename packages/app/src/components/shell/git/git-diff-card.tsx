"use client";
import { IconChevronRightMedium, IconClipboard, IconStepBack } from "central-icons";
import type { GitFilePatchResult } from "@multi/contracts";
import { MiddleTruncate } from "@pierre/truncate/react";
import { type RefObject, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@multi/multikit/button";
import { Checkbox } from "@multi/multikit/checkbox";

import type { DiffRow } from "~/hooks/use-environment-git";
import { cn } from "~/lib/utils";
import { useMountEffect } from "~/hooks/use-mount-effect";

import { DiffViewer } from "./diff-viewer";
import { VsFileIcon } from "./vscode-file-icon";

function isRenderablePatch(
  patch: GitFilePatchResult | null,
): patch is Extract<GitFilePatchResult, { kind: "patch" | "untracked" }> {
  return (patch?.kind === "patch" || patch?.kind === "untracked") && patch.patch.trim().length > 0;
}

export function GitDiffCard(props: {
  file: DiffRow;
  selected: boolean;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  patch: GitFilePatchResult | null;
  diffRequested: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  diffStyle: "unified" | "split";
  viewed: boolean;
  onToggleViewed: () => void;
  onRevert: () => void;
  requestPrefetchForIdRef: RefObject<(id: string) => void>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  const copyPath = () => {
    void navigator.clipboard.writeText(props.file.path);
    toast.success("Path copied");
  };

  const hasDiffBody = props.diffRequested || props.loaded || props.error !== null;
  const showLoading = props.diffRequested && (props.loading || (!props.loaded && !props.error));
  const toggleExpanded = () => props.onExpandedChange(!props.expanded);
  const toggleViewed = () => {
    props.onToggleViewed();
    props.onExpandedChange(false);
  };
  const renderablePatch = isRenderablePatch(props.patch);

  if (!props.error && renderablePatch && props.expanded) {
    return (
      <div
        ref={rootRef}
        data-diff-card-id={props.file.id}
        className={cn(
          "@container min-w-0 border-0 border-b border-multi-workbench-panel-border-muted bg-(--multi-chat-surface-background) last:border-b-transparent",
          props.selected && "bg-(--multi-chat-surface-background)",
        )}
      >
        {props.expanded ? (
          <ExpandedGitDiffCardPrefetchObserver
            key={props.file.id}
            fileId={props.file.id}
            rootRef={rootRef}
            requestPrefetchForIdRef={props.requestPrefetchForIdRef}
          />
        ) : null}
        <DiffViewer
          filePatch={props.patch}
          path={props.file.path}
          state={props.file.state}
          prevPath={props.file.prevPath}
          diffStyle={props.diffStyle}
          renderCustomHeader={() => (
            <GitDiffCardHeader
              file={props.file}
              patch={props.patch}
              expanded={props.expanded}
              viewed={props.viewed}
              onCopyPath={copyPath}
              onRevert={props.onRevert}
              onToggleExpanded={toggleExpanded}
              onToggleViewed={toggleViewed}
            />
          )}
          className="min-h-0"
        />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-diff-card-id={props.file.id}
      className={cn(
        "@container flex min-h-0 min-w-0 select-none flex-col overflow-hidden border-0 border-b border-multi-workbench-panel-border-muted bg-(--multi-chat-surface-background) transition-colors last:border-b-transparent",
        props.selected && "bg-(--multi-chat-surface-background)",
      )}
    >
      {props.expanded ? (
        <ExpandedGitDiffCardPrefetchObserver
          key={props.file.id}
          fileId={props.file.id}
          rootRef={rootRef}
          requestPrefetchForIdRef={props.requestPrefetchForIdRef}
        />
      ) : null}
      <GitDiffCardHeader
        file={props.file}
        patch={props.patch}
        expanded={props.expanded}
        viewed={props.viewed}
        onCopyPath={copyPath}
        onRevert={props.onRevert}
        onToggleExpanded={toggleExpanded}
        onToggleViewed={toggleViewed}
      />
      {props.expanded && hasDiffBody ? (
        <div className="min-h-0 min-w-0 bg-(--multi-git-diff-editor-background) select-text">
          {showLoading ? (
            <div className="flex flex-col gap-2 p-3">
              <div className="h-3 w-full max-w-56 animate-pulse rounded bg-muted/35" />
              <div className="h-3 w-full animate-pulse rounded bg-muted/28" />
            </div>
          ) : props.error ? (
            <div className="p-3 text-detail text-destructive/90">{props.error}</div>
          ) : (
            <DiffViewer
              filePatch={props.patch}
              path={props.file.path}
              state={props.file.state}
              prevPath={props.file.prevPath}
              diffStyle={props.diffStyle}
              className="min-h-0"
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

export function GitDiffCardHeader(props: {
  readonly file: DiffRow;
  readonly patch: GitFilePatchResult | null;
  readonly expanded: boolean;
  readonly viewed: boolean;
  readonly showViewed?: boolean | undefined;
  readonly statusLabel?: string | undefined;
  readonly statusTone?: "muted" | "danger" | undefined;
  readonly onCopyPath: () => void;
  readonly onRevert: () => void;
  readonly onToggleExpanded: () => void;
  readonly onToggleViewed: () => void;
}) {
  const showViewed = props.showViewed ?? true;
  const fileStatus = resolveGitDiffHeaderStatus(props);

  return (
    <div
      className={cn(
        "group/git-diff-header flex h-8 min-h-8 w-full shrink-0 select-none flex-nowrap items-center gap-1 overflow-hidden border-b bg-(--multi-git-diff-editor-background) px-1.5 py-0 text-multi-code",
        props.expanded ? "border-multi-git-diff-header-border" : "border-b-transparent",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={props.onToggleExpanded}
        className="group/git-diff-toggle h-full min-w-0 flex-1 justify-start gap-1.5 overflow-hidden rounded-none border-0 px-1 py-0 text-left shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent"
        aria-label={`${props.expanded ? "Collapse" : "Expand"} ${props.file.path}`}
        aria-expanded={props.expanded}
        title={props.file.path}
      >
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-multi-icon-secondary">
          <VsFileIcon path={props.file.path} className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 basis-0 items-center overflow-hidden">
          <MiddleTruncate
            split="leaf-path"
            priority="end"
            className="min-w-0 flex-1 font-normal text-multi-fg-primary [--truncate-marker-background-color:var(--multi-git-diff-editor-background)]"
          >
            {props.file.path}
          </MiddleTruncate>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-multi-mono tabular-nums @max-[360px]:gap-1">
          {props.file.add > 0 ? (
            <span className="text-(--multi-diff-addition)">+{props.file.add}</span>
          ) : null}
          {props.file.del > 0 ? (
            <span className="text-(--multi-diff-deletion)">-{props.file.del}</span>
          ) : null}
        </span>
      </Button>
      <span className="inline-flex min-w-0 shrink-0 items-center gap-2">
        <GitDiffHeaderIconButton
          onClick={props.onCopyPath}
          aria-label="Copy path"
          title="Copy path"
        >
          <IconClipboard className="size-4 shrink-0" />
        </GitDiffHeaderIconButton>
        {fileStatus ? (
          <span
            className={cn(
              "max-w-24 shrink-0 truncate font-multi text-multi-code tabular-nums",
              fileStatus.className,
            )}
            title={fileStatus.label}
          >
            {fileStatus.label}
          </span>
        ) : null}
        <GitDiffHeaderIconButton
          onClick={props.onRevert}
          aria-label="Discard changes"
          title="Discard changes"
        >
          <IconStepBack className="size-4 shrink-0" />
        </GitDiffHeaderIconButton>
        {showViewed ? (
          <Checkbox
            aria-label="Viewed"
            checked={props.viewed}
            onCheckedChange={props.onToggleViewed}
            className="size-4"
          />
        ) : null}
      </span>
    </div>
  );
}

function GitDiffHeaderIconButton(props: {
  readonly "aria-label": string;
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly title: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={props.onClick}
      aria-label={props["aria-label"]}
      title={props.title}
      className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-[4px] border-0 bg-transparent px-1 text-multi-icon-secondary shadow-none before:hidden transition-colors hover:bg-transparent hover:text-multi-icon-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:ring-inset"
    >
      {props.children}
    </Button>
  );
}

function resolveGitDiffHeaderStatus(props: {
  readonly file: DiffRow;
  readonly statusLabel?: string | undefined;
  readonly statusTone?: "muted" | "danger" | undefined;
}): { readonly label: string; readonly className: string } | null {
  if (props.statusLabel) {
    return {
      label: props.statusLabel,
      className: props.statusTone === "danger" ? "text-destructive/85" : "text-multi-fg-tertiary",
    };
  }

  switch (props.file.state) {
    case "added":
      return { label: "Added", className: "text-(--multi-diff-addition)" };
    case "conflict":
      return { label: "Conflict", className: "text-destructive/90" };
    case "deleted":
      return { label: "Deleted", className: "text-(--multi-diff-deletion)" };
    case "ignored":
      return { label: "Ignored", className: "text-multi-fg-tertiary" };
    case "modified":
      return props.file.add === 0 && props.file.del === 0
        ? { label: "Changed", className: "text-multi-fg-tertiary" }
        : null;
    case "renamed":
      return { label: "Renamed", className: "text-multi-fg-tertiary" };
    case "untracked":
      return { label: "Untracked", className: "text-(--multi-diff-addition)" };
    default:
      return null;
  }
}

function ExpandedGitDiffCardPrefetchObserver(props: {
  readonly fileId: string;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly requestPrefetchForIdRef: RefObject<(id: string) => void>;
}) {
  useMountEffect(() => {
    const el = props.rootRef.current;
    if (!el) return;

    let prefetched = false;
    const scrollRoot = el.closest(".git-diff-scroll-root");
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || prefetched) continue;
          prefetched = true;
          props.requestPrefetchForIdRef.current(props.fileId);
          obs.disconnect();
          return;
        }
      },
      {
        root: scrollRoot instanceof HTMLElement ? scrollRoot : null,
        rootMargin: "600px 0px 480px 0px",
        threshold: 0,
      },
    );

    obs.observe(el);
    return () => obs.disconnect();
  });

  return null;
}
