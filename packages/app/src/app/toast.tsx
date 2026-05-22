"use client";

import { Toast } from "@base-ui/react/toast";
import { useMemo, type CSSProperties } from "react";
import { useParams } from "@tanstack/react-router";
import { type ScopedThreadRef, type ThreadId } from "@multi/contracts";
import {
  IconCheckmark1,
  IconCircleCheck,
  IconCircleInfo,
  IconClipboard,
  IconCrossSmall,
  IconExclamationCircle,
  IconExclamationTriangle,
  IconLoader,
} from "central-icons";

import { cn } from "~/lib/utils";
import { buttonVariants } from "@multi/ui/button";
import { useComposerDraftStore } from "~/stores/chat-drafts";
import { useCopyToClipboard } from "~/hooks/use-copy-to-clipboard";
import { resolveThreadRouteTarget } from "~/app/routes/thread-route-targets";
import { useMountEffect } from "~/hooks/use-mount-effect";

export type ThreadToastData = {
  threadRef?: ScopedThreadRef | null;
  threadId?: ThreadId | null;
  tooltipStyle?: boolean;
  dismissAfterVisibleMs?: number;
  hideCopyButton?: boolean;
};

const toastManager = Toast.createToastManager<ThreadToastData>();
const anchoredToastManager = Toast.createToastManager<ThreadToastData>();
type ToastId = ReturnType<typeof toastManager.add>;
const threadToastVisibleTimeoutRemainingMs = new Map<ToastId, number>();

function shouldHideCollapsedToastContent(
  visibleToastIndex: number,
  visibleToastCount: number,
): boolean {
  // Keep the front-most toast readable even if Base UI marks it as "behind"
  // due to toasts hidden by thread filtering.
  if (visibleToastCount <= 1) return false;
  return visibleToastIndex > 0;
}

type ToastWithHeight = {
  height?: number | null | undefined;
};

type VisibleToastLayoutItem<TToast extends object> = {
  toast: TToast;
  visibleIndex: number;
  offsetY: number;
};

function buildVisibleToastLayout<TToast extends object>(
  visibleToasts: readonly (TToast & ToastWithHeight)[],
): {
  frontmostHeight: number;
  items: VisibleToastLayoutItem<TToast & ToastWithHeight>[];
} {
  let offsetY = 0;

  return {
    frontmostHeight: normalizeToastHeight(visibleToasts[0]?.height),
    items: visibleToasts.map((toast, visibleIndex) => {
      const item = {
        toast,
        visibleIndex,
        offsetY,
      };

      offsetY += normalizeToastHeight(toast.height);
      return item;
    }),
  };
}

function normalizeToastHeight(height: number | null | undefined): number {
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : 0;
}

function shouldRenderThreadScopedToast(
  data:
    | {
        threadRef?: ScopedThreadRef | null;
        threadId?: ThreadId | null;
      }
    | undefined,
  activeThreadRef: ScopedThreadRef | null,
): boolean {
  if (data?.threadRef) {
    return (
      activeThreadRef !== null &&
      data.threadRef.environmentId === activeThreadRef.environmentId &&
      data.threadRef.threadId === activeThreadRef.threadId
    );
  }

  const toastThreadId = data?.threadId;
  if (!toastThreadId) {
    return true;
  }

  return activeThreadRef?.threadId === toastThreadId;
}

const TOAST_ICONS = {
  error: IconExclamationCircle,
  info: IconCircleInfo,
  loading: IconLoader,
  success: IconCircleCheck,
  warning: IconExclamationTriangle,
} as const;

function CopyErrorButton({ text }: { text: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  return (
    <button
      className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground opacity-60 transition-opacity hover:opacity-100"
      onClick={() => copyToClipboard(text)}
      title="Copy error"
      type="button"
    >
      {isCopied ? (
        <IconCheckmark1 className="size-3.5 text-success" />
      ) : (
        <IconClipboard className="size-3.5" />
      )}
    </button>
  );
}

type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

interface ToastProviderProps extends Toast.Provider.Props {
  position?: ToastPosition;
}

function useActiveThreadRefFromRoute(): ScopedThreadRef | null {
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const activeDraftSession = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );

  return useMemo(() => {
    if (routeTarget?.kind === "server") {
      return routeTarget.threadRef;
    }
    if (routeTarget?.kind === "draft" && activeDraftSession) {
      return {
        environmentId: activeDraftSession.environmentId,
        threadId: activeDraftSession.threadId,
      };
    }
    return null;
  }, [activeDraftSession, routeTarget]);
}

function ThreadToastVisibleAutoDismiss({
  toastId,
  dismissAfterVisibleMs,
}: {
  toastId: ToastId;
  dismissAfterVisibleMs: number | undefined;
}) {
  if (!dismissAfterVisibleMs || dismissAfterVisibleMs <= 0) {
    return null;
  }

  return (
    <ThreadToastVisibleAutoDismissLifecycle
      key={`${String(toastId)}:${dismissAfterVisibleMs}`}
      dismissAfterVisibleMs={dismissAfterVisibleMs}
      toastId={toastId}
    />
  );
}

function ThreadToastVisibleAutoDismissLifecycle({
  toastId,
  dismissAfterVisibleMs,
}: {
  toastId: ToastId;
  dismissAfterVisibleMs: number;
}) {
  useMountEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let remainingMs = threadToastVisibleTimeoutRemainingMs.get(toastId) ?? dismissAfterVisibleMs;
    let startedAtMs: number | null = null;
    let timeoutId: number | null = null;
    let closed = false;

    const clearTimer = () => {
      if (timeoutId === null) return;
      window.clearTimeout(timeoutId);
      timeoutId = null;
    };

    const closeToast = () => {
      if (closed) return;
      closed = true;
      threadToastVisibleTimeoutRemainingMs.delete(toastId);
      toastManager.close(toastId);
    };

    const pause = () => {
      if (startedAtMs === null) return;
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAtMs));
      startedAtMs = null;
      clearTimer();
      threadToastVisibleTimeoutRemainingMs.set(toastId, remainingMs);
    };

    const start = () => {
      if (closed || startedAtMs !== null) return;
      if (remainingMs <= 0) {
        closeToast();
        return;
      }
      startedAtMs = Date.now();
      clearTimer();
      timeoutId = window.setTimeout(() => {
        remainingMs = 0;
        startedAtMs = null;
        closeToast();
      }, remainingMs);
    };

    const syncTimer = () => {
      const shouldRun = document.visibilityState === "visible" && document.hasFocus();
      if (shouldRun) {
        start();
        return;
      }
      pause();
    };

    syncTimer();
    document.addEventListener("visibilitychange", syncTimer);
    window.addEventListener("focus", syncTimer);
    window.addEventListener("blur", syncTimer);

    return () => {
      document.removeEventListener("visibilitychange", syncTimer);
      window.removeEventListener("focus", syncTimer);
      window.removeEventListener("blur", syncTimer);
      pause();
      clearTimer();
    };
  });

  return null;
}

function createToastIdsKey(toastIds: readonly ToastId[]): string {
  return JSON.stringify(toastIds);
}

function ThreadToastVisibleTimeoutRegistrySync({ toastIds }: { toastIds: readonly ToastId[] }) {
  useMountEffect(() => {
    const activeToastIds = new Set(toastIds);
    for (const toastId of threadToastVisibleTimeoutRemainingMs.keys()) {
      if (!activeToastIds.has(toastId)) {
        threadToastVisibleTimeoutRemainingMs.delete(toastId);
      }
    }
  });

  return null;
}

function ToastProvider({ children, position = "top-right", ...props }: ToastProviderProps) {
  return (
    <Toast.Provider toastManager={toastManager} {...props}>
      {children}
      <Toasts position={position} />
    </Toast.Provider>
  );
}

function Toasts({ position = "top-right" }: { position: ToastPosition }) {
  const { toasts } = Toast.useToastManager<ThreadToastData>();
  const activeThreadRef = useActiveThreadRefFromRoute();
  const isTop = position.startsWith("top");
  const visibleToasts = toasts.filter((toast) =>
    shouldRenderThreadScopedToast(toast.data, activeThreadRef),
  );
  const visibleToastLayout = buildVisibleToastLayout(visibleToasts);
  const toastIds = toasts.map((toast) => toast.id);

  return (
    <>
      <ThreadToastVisibleTimeoutRegistrySync
        key={createToastIdsKey(toastIds)}
        toastIds={toastIds}
      />
      <Toast.Portal data-slot="toast-portal">
        <Toast.Viewport
          className={cn(
            "fixed z-100 mx-auto flex w-[calc(100vw-(var(--toast-inset)*2))] max-w-[340px] [--toast-header-offset:52px] [--toast-inset:--spacing(4)] sm:[--toast-inset:--spacing(8)]",
            // Vertical positioning
            "data-[position*=top]:top-[calc(var(--toast-inset)+var(--toast-header-offset))]",
            "data-[position*=bottom]:bottom-(--toast-inset)",
            // Horizontal positioning
            "data-[position*=left]:left-(--toast-inset)",
            "data-[position*=right]:right-(--toast-inset)",
            "data-[position*=center]:-translate-x-1/2 data-[position*=center]:left-1/2",
          )}
          data-position={position}
          data-slot="toast-viewport"
          style={
            {
              "--toast-frontmost-height": `${visibleToastLayout.frontmostHeight}px`,
            } as CSSProperties
          }
        >
          {visibleToastLayout.items.map(({ toast, visibleIndex, offsetY }) => {
            const Icon = toast.type ? TOAST_ICONS[toast.type as keyof typeof TOAST_ICONS] : null;
            const hideCollapsedContent = shouldHideCollapsedToastContent(
              visibleIndex,
              visibleToastLayout.items.length,
            );

            return (
              <Toast.Root
                className={cn(
                  "absolute isolate z-[calc(9999-var(--toast-index))] box-border h-(--toast-calc-height) w-full select-none overflow-hidden rounded-[6px] border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 [transition:transform_.5s_cubic-bezier(.22,1,.36,1),opacity_.5s,height_.15s] before:pointer-events-none before:absolute before:inset-0 before:rounded-[5px] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
                  // Base positioning using data-position
                  "data-[position*=right]:right-0 data-[position*=right]:left-auto",
                  "data-[position*=left]:right-auto data-[position*=left]:left-0",
                  "data-[position*=center]:right-0 data-[position*=center]:left-0",
                  "data-[position*=top]:top-0 data-[position*=top]:bottom-auto data-[position*=top]:origin-top",
                  "data-[position*=bottom]:top-auto data-[position*=bottom]:bottom-0 data-[position*=bottom]:origin-bottom",
                  // Gap fill for hover
                  "after:absolute after:left-0 after:h-[calc(var(--toast-gap)+1px)] after:w-full",
                  "data-[position*=top]:after:top-full",
                  "data-[position*=bottom]:after:bottom-full",
                  // Define some variables
                  // Base UI exposes a shared front-most height for the collapsed stack.
                  // If that shared measurement is briefly stale, long content can render
                  // outside the card until hover expands the toast and swaps to its own height.
                  "[--toast-calc-height:max(var(--toast-frontmost-height,var(--toast-height)),var(--toast-height))] [--toast-gap:--spacing(3)] [--toast-peek:--spacing(3)] [--toast-scale:calc(max(0,1-(var(--toast-index)*.1)))] [--toast-shrink:calc(1-var(--toast-scale))]",
                  // Define offset-y variable
                  "data-[position*=top]:[--toast-calc-offset-y:calc(var(--toast-offset-y)+var(--toast-index)*var(--toast-gap)+var(--toast-swipe-movement-y))]",
                  "data-[position*=bottom]:[--toast-calc-offset-y:calc(var(--toast-offset-y)*-1+var(--toast-index)*var(--toast-gap)*-1+var(--toast-swipe-movement-y))]",
                  // Default state transform
                  "data-[position*=top]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--toast-peek))+(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]",
                  "data-[position*=bottom]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--toast-peek))-(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]",
                  // Limited state
                  "data-limited:opacity-0",
                  // Expanded state
                  "data-expanded:h-(--toast-height)",
                  "data-position:data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-calc-offset-y))]",
                  // Starting and ending animations
                  "data-[position*=top]:data-starting-style:transform-[translateY(calc(-100%-var(--toast-inset)))]",
                  "data-[position*=bottom]:data-starting-style:transform-[translateY(calc(100%+var(--toast-inset)))]",
                  "data-[position*=top]:data-[position*=right]:data-starting-style:transform-[translateX(calc(100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                  "data-ending-style:opacity-0",
                  // Ending animations (direction-aware)
                  "data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateY(calc(100%+var(--toast-inset)))]",
                  "data-[position*=top]:data-[position*=right]:data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateX(calc(100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                  "data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                  "data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                  "data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]",
                  "data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]",
                  // Ending animations (expanded)
                  "data-expanded:data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                  "data-expanded:data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                  "data-expanded:data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]",
                  "data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]",
                )}
                data-position={position}
                data-slot="toast-popup"
                key={toast.id}
                style={
                  {
                    "--toast-index": visibleIndex,
                    "--toast-offset-y": `${offsetY}px`,
                  } as CSSProperties
                }
                swipeDirection={
                  position.includes("center")
                    ? [isTop ? "up" : "down"]
                    : position.includes("left")
                      ? ["left", isTop ? "up" : "down"]
                      : ["right", isTop ? "up" : "down"]
                }
                toast={toast}
              >
                <ThreadToastVisibleAutoDismiss
                  dismissAfterVisibleMs={toast.data?.dismissAfterVisibleMs}
                  toastId={toast.id}
                />
                <Toast.Content
                  className={cn(
                    "pointer-events-auto flex items-center justify-between gap-1.5 overflow-hidden px-3.5 py-3 text-sm transition-opacity duration-250 data-expanded:opacity-100",
                    hideCollapsedContent &&
                      "not-data-expanded:pointer-events-none not-data-expanded:opacity-0",
                  )}
                  data-slot="toast-content"
                >
                  <div className="flex min-w-0 flex-1 gap-2">
                    {Icon && (
                      <div
                        className="[&>svg]:h-lh [&>svg]:w-4 [&_svg]:pointer-events-none [&_svg]:shrink-0"
                        data-slot="toast-icon"
                      >
                        <Icon className="in-data-[type=loading]:animate-spin in-data-[type=error]:text-destructive in-data-[type=info]:text-info in-data-[type=success]:text-success in-data-[type=warning]:text-warning in-data-[type=loading]:opacity-80" />
                      </div>
                    )}

                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-1">
                        <Toast.Title
                          className="min-w-0 wrap-break-word font-medium"
                          data-slot="toast-title"
                        />
                        {toast.type === "error" &&
                          typeof toast.description === "string" &&
                          !toast.data?.hideCopyButton && (
                            <CopyErrorButton text={toast.description} />
                          )}
                      </div>
                      <Toast.Description
                        className="min-w-0 select-text wrap-break-word text-muted-foreground"
                        data-slot="toast-description"
                      />
                    </div>
                  </div>
                  {toast.actionProps && (
                    <Toast.Action
                      {...toast.actionProps}
                      className={cn(
                        buttonVariants({ size: "xs" }),
                        "shrink-0",
                        toast.actionProps.className,
                      )}
                      data-slot="toast-action"
                    />
                  )}
                  <button
                    type="button"
                    className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-70 transition-colors hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
                    aria-label="Dismiss notification"
                    title="Dismiss notification"
                    onClick={() => toastManager.close(toast.id)}
                  >
                    <IconCrossSmall className="size-3" aria-hidden />
                  </button>
                </Toast.Content>
              </Toast.Root>
            );
          })}
        </Toast.Viewport>
      </Toast.Portal>
    </>
  );
}

function AnchoredToastProvider({ children, ...props }: Toast.Provider.Props) {
  return (
    <Toast.Provider toastManager={anchoredToastManager} {...props}>
      {children}
      <AnchoredToasts />
    </Toast.Provider>
  );
}

function AnchoredToasts() {
  const { toasts } = Toast.useToastManager<ThreadToastData>();
  const activeThreadRef = useActiveThreadRefFromRoute();

  return (
    <Toast.Portal data-slot="toast-portal-anchored">
      <Toast.Viewport className="outline-none" data-slot="toast-viewport-anchored">
        {toasts
          .filter((toast) => shouldRenderThreadScopedToast(toast.data, activeThreadRef))
          .map((toast) => {
            const Icon = toast.type ? TOAST_ICONS[toast.type as keyof typeof TOAST_ICONS] : null;
            const tooltipStyle = toast.data?.tooltipStyle ?? false;
            const positionerProps = toast.positionerProps;

            if (!positionerProps?.anchor) {
              return null;
            }

            return (
              <Toast.Positioner
                className="z-100 max-w-64"
                data-slot="toast-positioner"
                key={toast.id}
                sideOffset={positionerProps.sideOffset ?? 4}
                toast={toast}
              >
                <Toast.Root
                  className={cn(
                    "relative text-balance border bg-popover not-dark:bg-clip-padding text-popover-foreground text-xs transition-[scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
                    tooltipStyle
                      ? "rounded-md shadow-md/5 before:rounded-[calc(var(--radius-md)-1px)]"
                      : "rounded-lg shadow-lg/5 before:rounded-[calc(var(--radius-lg)-1px)]",
                  )}
                  data-slot="toast-popup"
                  toast={toast}
                >
                  {tooltipStyle ? (
                    <Toast.Content className="pointer-events-auto px-2 py-1">
                      <Toast.Title data-slot="toast-title" />
                    </Toast.Content>
                  ) : (
                    <Toast.Content
                      className="pointer-events-auto flex items-center justify-between gap-1.5 overflow-hidden px-3.5 py-3 text-sm"
                      data-slot="toast-content"
                    >
                      <div className="flex min-w-0 flex-1 gap-2">
                        {Icon && (
                          <div
                            className="[&>svg]:h-lh [&>svg]:w-4 [&_svg]:pointer-events-none [&_svg]:shrink-0"
                            data-slot="toast-icon"
                          >
                            <Icon className="in-data-[type=loading]:animate-spin in-data-[type=error]:text-destructive in-data-[type=info]:text-info in-data-[type=success]:text-success in-data-[type=warning]:text-warning in-data-[type=loading]:opacity-80" />
                          </div>
                        )}

                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex items-center gap-1">
                            <Toast.Title
                              className="min-w-0 wrap-break-word font-medium"
                              data-slot="toast-title"
                            />
                            {toast.type === "error" &&
                              typeof toast.description === "string" &&
                              !toast.data?.hideCopyButton && (
                                <CopyErrorButton text={toast.description} />
                              )}
                          </div>
                          <Toast.Description
                            className="min-w-0 select-text wrap-break-word text-muted-foreground"
                            data-slot="toast-description"
                          />
                        </div>
                      </div>
                      {toast.actionProps && (
                        <Toast.Action
                          className={cn(buttonVariants({ size: "xs" }), "shrink-0")}
                          data-slot="toast-action"
                        >
                          {toast.actionProps.children}
                        </Toast.Action>
                      )}
                    </Toast.Content>
                  )}
                </Toast.Root>
              </Toast.Positioner>
            );
          })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export {
  ToastProvider,
  type ToastPosition,
  toastManager,
  AnchoredToastProvider,
  anchoredToastManager,
};
