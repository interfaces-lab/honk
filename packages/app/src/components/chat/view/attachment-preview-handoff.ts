import {
  createElement,
  type RefObject,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";

import type { MessageId } from "@multi/contracts";
import { useMountEffect } from "~/hooks/use-mount-effect";
import type { ChatMessage } from "../../../types";
import { revokeBlobPreviewUrl } from "../message/preview-url-lifecycle";

type PreviewHandoffByMessageId = Record<string, string[]>;

function serverPreviewPromotionKey(messages: readonly ChatMessage[] | undefined): string {
  return JSON.stringify(
    messages?.map((message) => [
      message.id,
      message.role,
      message.attachments?.map((attachment) =>
        attachment.type === "image" ? attachment.previewUrl ?? "" : "",
      ) ?? [],
    ]) ?? [],
  );
}

function previewHandoffKey(previewsByMessageId: PreviewHandoffByMessageId): string {
  return JSON.stringify(
    Object.entries(previewsByMessageId).toSorted(([leftMessageId], [rightMessageId]) =>
      leftMessageId.localeCompare(rightMessageId),
    ),
  );
}

export function useAttachmentPreviewHandoff(input: {
  serverMessages: readonly ChatMessage[] | undefined;
}) {
  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] =
    useState<PreviewHandoffByMessageId>({});
  const attachmentPreviewHandoffByMessageIdRef = useRef<PreviewHandoffByMessageId>({});
  const attachmentPreviewPromotionInFlightByMessageIdRef = useRef<Record<string, true>>({});

  const clearAttachmentPreviewHandoff = useCallback((
    messageId: MessageId,
    previewUrls?: ReadonlyArray<string>,
  ) => {
    delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
    const currentPreviewUrls =
      previewUrls ?? attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    setAttachmentPreviewHandoffByMessageId((existing) => {
      if (!(messageId in existing)) {
        return existing;
      }
      const next = { ...existing };
      delete next[messageId];
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });
    for (const previewUrl of currentPreviewUrls) {
      revokeBlobPreviewUrl(previewUrl);
    }
  }, []);

  const clearAttachmentPreviewHandoffs = useCallback(() => {
    attachmentPreviewPromotionInFlightByMessageIdRef.current = {};
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId((existing) =>
      Object.keys(existing).length === 0 ? existing : {},
    );
  }, []);

  const handoffAttachmentPreviews = useCallback((messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    const previewUrlSet = new Set(previewUrls);
    for (const previewUrl of previousPreviewUrls) {
      if (!previewUrlSet.has(previewUrl)) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = {
        ...existing,
        [messageId]: previewUrls,
      };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });
  }, []);

  const attachmentPreviewHandoffSync: ReactNode = createElement(
    AttachmentPreviewHandoffPromotionSync,
    {
      key: `${serverPreviewPromotionKey(input.serverMessages)}:${previewHandoffKey(
        attachmentPreviewHandoffByMessageId,
      )}`,
      attachmentPreviewHandoffByMessageId,
      attachmentPreviewPromotionInFlightByMessageIdRef,
      clearAttachmentPreviewHandoff,
      serverMessages: input.serverMessages,
    },
  );

  const applyAttachmentPreviewHandoff = useCallback(
    (messages: ChatMessage[]): ChatMessage[] => {
      if (Object.keys(attachmentPreviewHandoffByMessageId).length === 0) {
        return messages;
      }

      return messages.map((message) => {
        if (message.role !== "user" || !message.attachments || message.attachments.length === 0) {
          return message;
        }
        const handoffPreviewUrls = attachmentPreviewHandoffByMessageId[message.id];
        if (!handoffPreviewUrls || handoffPreviewUrls.length === 0) {
          return message;
        }

        let changed = false;
        let imageIndex = 0;
        const attachments = message.attachments.map((attachment) => {
          if (attachment.type !== "image") {
            return attachment;
          }
          const handoffPreviewUrl = handoffPreviewUrls[imageIndex];
          imageIndex += 1;
          if (!handoffPreviewUrl || attachment.previewUrl === handoffPreviewUrl) {
            return attachment;
          }
          changed = true;
          return {
            ...attachment,
            previewUrl: handoffPreviewUrl,
          };
        });

        return changed ? { ...message, attachments } : message;
      });
    },
    [attachmentPreviewHandoffByMessageId],
  );

  useMountEffect(() => clearAttachmentPreviewHandoffs);

  return {
    attachmentPreviewHandoffSync,
    applyAttachmentPreviewHandoff,
    clearAttachmentPreviewHandoffs,
    handoffAttachmentPreviews,
  };
}

function AttachmentPreviewHandoffPromotionSync({
  attachmentPreviewHandoffByMessageId,
  attachmentPreviewPromotionInFlightByMessageIdRef,
  clearAttachmentPreviewHandoff,
  serverMessages,
}: {
  attachmentPreviewHandoffByMessageId: PreviewHandoffByMessageId;
  attachmentPreviewPromotionInFlightByMessageIdRef: RefObject<Record<string, true>>;
  clearAttachmentPreviewHandoff: (
    messageId: MessageId,
    previewUrls?: ReadonlyArray<string>,
  ) => void;
  serverMessages: readonly ChatMessage[] | undefined;
}) {
  useMountEffect(() => {
    if (typeof Image === "undefined" || !serverMessages || serverMessages.length === 0) {
      return;
    }

    const cleanups: Array<() => void> = [];

    for (const [messageId, handoffPreviewUrls] of Object.entries(
      attachmentPreviewHandoffByMessageId,
    )) {
      if (attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId]) {
        continue;
      }

      const serverMessage = serverMessages.find(
        (message) => message.id === messageId && message.role === "user",
      );
      if (!serverMessage?.attachments || serverMessage.attachments.length === 0) {
        continue;
      }

      const serverPreviewUrls = serverMessage.attachments.flatMap((attachment) =>
        attachment.type === "image" && attachment.previewUrl ? [attachment.previewUrl] : [],
      );
      if (
        serverPreviewUrls.length === 0 ||
        serverPreviewUrls.length !== handoffPreviewUrls.length ||
        serverPreviewUrls.some((previewUrl) => previewUrl.startsWith("blob:"))
      ) {
        continue;
      }

      attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId] = true;

      let cancelled = false;
      const imageInstances: HTMLImageElement[] = [];

      const preloadServerPreviews = Promise.all(
        serverPreviewUrls.map(
          (previewUrl) =>
            new Promise<void>((resolve, reject) => {
              const image = new Image();
              imageInstances.push(image);
              const handleLoad = () => resolve();
              const handleError = () =>
                reject(new Error(`Failed to load server preview for ${messageId}.`));
              image.addEventListener("load", handleLoad, { once: true });
              image.addEventListener("error", handleError, { once: true });
              image.src = previewUrl;
            }),
        ),
      );

      void preloadServerPreviews
        .then(() => {
          if (cancelled) {
            return;
          }
          clearAttachmentPreviewHandoff(messageId as MessageId, handoffPreviewUrls);
        })
        .catch(() => {
          if (!cancelled) {
            delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
          }
        });

      cleanups.push(() => {
        cancelled = true;
        delete attachmentPreviewPromotionInFlightByMessageIdRef.current[messageId];
        for (const image of imageInstances) {
          image.src = "";
        }
      });
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  });

  return null;
}
