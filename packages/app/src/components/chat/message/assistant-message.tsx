import { type TurnId } from "@multi/contracts";
import { memo } from "react";
import { type TurnDiffSummary, type ChatMessage } from "../../../types";
import { summarizeTurnDiffStats } from "../../../lib/turn-diff-tree";
import ChatMarkdown from "../markdown/chat-markdown";
import { Button } from "@multi/ui/button";
import { ChangedFilesTree } from "./changed-files-tree";
import { DiffStatLabel, hasNonZeroStat } from "./diff-stat-label";
import { useUiStateStore } from "~/ui-state-store";
import { ChatMessageBubble } from "./message-surface";
import { cn } from "~/lib/utils";

interface AssistantMessageProps {
  message: ChatMessage;
  showCompletionDivider: boolean;
  assistantTurnDiffSummary: TurnDiffSummary | undefined;
  completionSummary: string | null;
  routeThreadKey: string;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  showCompletionDivider,
  assistantTurnDiffSummary,
  completionSummary,
  routeThreadKey,
  markdownCwd,
  resolvedTheme,
  onOpenTurnDiff,
}: AssistantMessageProps) {
  const messageText = message.text || (message.streaming ? "" : "(empty response)");

  const body = (
    <>
      <div className="select-text [&_*]:select-text">
        <ChatMarkdown
          text={messageText}
          cwd={markdownCwd}
          isStreaming={Boolean(message.streaming)}
        />
      </div>
      <AssistantChangedFilesSection
        turnSummary={assistantTurnDiffSummary}
        routeThreadKey={routeThreadKey}
        resolvedTheme={resolvedTheme}
        onOpenTurnDiff={onOpenTurnDiff}
      />
    </>
  );

  return (
    <div className="min-w-0 pt-(--chat-timeline-assistant-top-inset)">
      {showCompletionDivider && (
        <div className="my-3 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span
            className={cn(
              "rounded-full border border-border bg-background px-2.5 py-1",
              "text-caption/[12px] tracking-[0.14em] text-muted-foreground/80 uppercase",
            )}
          >
            {completionSummary ? `Response \u2022 ${completionSummary}` : "Response"}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      <ChatMessageBubble role="assistant" body={body} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// AssistantChangedFilesSection
// ---------------------------------------------------------------------------

const AssistantChangedFilesSection = memo(function AssistantChangedFilesSection({
  turnSummary,
  routeThreadKey,
  resolvedTheme,
  onOpenTurnDiff,
}: {
  turnSummary: TurnDiffSummary | undefined;
  routeThreadKey: string;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  if (!turnSummary) return null;
  const checkpointFiles = turnSummary.files;
  if (checkpointFiles.length === 0) return null;

  return (
    <AssistantChangedFilesSectionInner
      turnSummary={turnSummary}
      checkpointFiles={checkpointFiles}
      routeThreadKey={routeThreadKey}
      resolvedTheme={resolvedTheme}
      onOpenTurnDiff={onOpenTurnDiff}
    />
  );
});

function AssistantChangedFilesSectionInner({
  turnSummary,
  checkpointFiles,
  routeThreadKey,
  resolvedTheme,
  onOpenTurnDiff,
}: {
  turnSummary: TurnDiffSummary;
  checkpointFiles: TurnDiffSummary["files"];
  routeThreadKey: string;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  const allDirectoriesExpanded = useUiStateStore(
    (store) => store.threadChangedFilesExpandedById[routeThreadKey]?.[turnSummary.turnId] ?? true,
  );
  const setExpanded = useUiStateStore((store) => store.setThreadChangedFilesExpanded);
  const summaryStat = summarizeTurnDiffStats(checkpointFiles);
  const changedFileCountLabel = String(checkpointFiles.length);

  return (
    <div className="mt-2 rounded-lg border border-multi-stroke bg-multi-editor overflow-hidden">
      <div className="flex h-7 items-center justify-between gap-2 border-b border-multi-stroke px-2">
        <p className="text-body text-foreground/80">
          <span>Changed files ({changedFileCountLabel})</span>
          {hasNonZeroStat(summaryStat) && (
            <>
              <span className="mx-1.5 text-muted-foreground/40">&bull;</span>
              <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} />
            </>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-5 px-1.5 text-detail"
            data-scroll-anchor-ignore
            onClick={() => setExpanded(routeThreadKey, turnSummary.turnId, !allDirectoriesExpanded)}
          >
            {allDirectoriesExpanded ? "Collapse" : "Expand"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-5 px-1.5 text-detail"
            onClick={() => onOpenTurnDiff(turnSummary.turnId, checkpointFiles[0]?.path)}
          >
            View diff
          </Button>
        </div>
      </div>
      <div className="p-2">
        <ChangedFilesTree
          key={`changed-files-tree:${turnSummary.turnId}`}
          turnId={turnSummary.turnId}
          files={checkpointFiles}
          allDirectoriesExpanded={allDirectoriesExpanded}
          resolvedTheme={resolvedTheme}
          onOpenTurnDiff={onOpenTurnDiff}
        />
      </div>
    </div>
  );
}
