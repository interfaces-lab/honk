import { useMemo } from "react";
import {
  buildWorkspaceChatSections,
  type SidebarChatItem,
  type SidebarDraftSummary,
  type SidebarSectionModel,
} from "../lib/sidebar-chat-view-model";
import { useComposerDraftStore } from "../composer-draft-store";
import { useThreadUnreadStore } from "../lib/thread-unread-store";
import { useThreadSummaries, useThreadSummariesStatus } from "../lib/thread-session-store";
import { useRouteThreadId } from "./use-route-thread-id";

export function useSidebarAgents(cwd: string | null, home: string | null) {
  const sums = useThreadSummaries();
  const status = useThreadSummariesStatus();
  const routeThreadId = useRouteThreadId();
  const draftThreadsByThreadKey = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const composerDraftsByThreadKey = useComposerDraftStore((state) => state.draftsByThreadKey);
  const drafts = useMemo<SidebarDraftSummary[]>(
    () =>
      Object.entries(draftThreadsByThreadKey)
        .filter(([, draftThread]) => draftThread.promotedTo == null)
        .map(([draftId, draftThread]) => {
          const composerDraft = composerDraftsByThreadKey[draftId];
          const firstAttachment =
            composerDraft?.images[0] ?? composerDraft?.persistedAttachments[0];
          return {
            id: draftId,
            text: composerDraft?.prompt ?? "",
            attachmentCount:
              (composerDraft?.images.length ?? 0) +
              (composerDraft?.persistedAttachments.length ?? 0),
            firstAttachmentName: firstAttachment?.name ?? null,
            cwd: draftThread.worktreePath ?? cwd ?? "/",
            updatedAt: draftThread.createdAt,
          };
        }),
    [composerDraftsByThreadKey, cwd, draftThreadsByThreadKey],
  );
  const selectedId = routeThreadId;
  const unread = useThreadUnreadStore((s) => s.unread);
  const unreadIds = useMemo(() => {
    return new Set(Object.keys(unread).filter((id) => unread[id]));
  }, [unread]);

  const sections = useMemo(
    () => buildWorkspaceChatSections(status === "ready" ? sums : {}, drafts, cwd, home, unreadIds),
    [cwd, drafts, home, status, sums, unreadIds],
  );

  const selected = useMemo(
    () =>
      selectedId
        ? (sections.flatMap((section) => section.items).find((item) => item.id === selectedId) ??
          null)
        : null,
    [sections, selectedId],
  );

  return {
    sections,
    routeThreadId,
    selectedId,
    selected,
    loading: status === "loading" && drafts.length === 0,
    error: status === "error" && drafts.length === 0,
  } satisfies {
    sections: SidebarSectionModel[];
    routeThreadId: string | null;
    selectedId: string | null;
    selected: SidebarChatItem | null;
    loading: boolean;
    error: boolean;
  };
}
