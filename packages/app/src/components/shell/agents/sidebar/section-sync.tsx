import type { ScopedThreadRef } from "@multi/contracts";

import { retainThreadDetailSubscription } from "~/environments/runtime/service";
import { useMountEffect } from "~/hooks/use-mount-effect";

export function SectionPrefetchSync({
  items,
  onPrefetchAgent,
}: {
  items: readonly { id: string }[];
  onPrefetchAgent: (id: string) => void;
}) {
  useMountEffect(() => {
    for (const item of items) {
      onPrefetchAgent(item.id);
    }
  });

  return null;
}

export function SectionVisibleThreadRefsSync({
  onVisibleThreadRefsChange,
  sectionId,
  threadRefs,
}: {
  onVisibleThreadRefsChange: (sectionId: string, threadRefs: readonly ScopedThreadRef[]) => void;
  sectionId: string;
  threadRefs: readonly ScopedThreadRef[];
}) {
  useMountEffect(() => {
    onVisibleThreadRefsChange(sectionId, threadRefs);
  });

  return null;
}

export function RetainedThreadDetailSubscriptions({
  threadRefs,
}: {
  threadRefs: readonly ScopedThreadRef[];
}) {
  useMountEffect(() => {
    const releases = threadRefs.map((threadRef) =>
      retainThreadDetailSubscription(threadRef.environmentId, threadRef.threadId),
    );

    return () => {
      for (const release of releases) {
        release();
      }
    };
  });

  return null;
}
