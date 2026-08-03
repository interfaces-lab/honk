// Toast state lives in a module store, never in component state: `honk/design-no-use-effect` is an
// error across packages/ui/src, so the dismiss timers cannot live in an effect. Mirrors the model in
// packages/app/src/toast-store.ts so both clients speak one vocabulary.
//
// Sonner owns this on the web. There is no native equivalent worth a dependency, so the store is a
// listener set plus a timer map, read through useSyncExternalStore.

import * as React from "react";

type ToastType = "error" | "info" | "loading" | "success" | "warning";

interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

interface ToastOptions {
  readonly description?: string;
  readonly action?: ToastAction;
  // Pass 0 to hold a toast open until something dismisses it. "loading" holds open by default.
  readonly durationMs?: number;
}

interface ToastItem {
  readonly id: string;
  readonly type: ToastType;
  readonly title: string;
  readonly description?: string;
  readonly action?: ToastAction;
}

const DEFAULT_DURATION_MS = 5_000;
// A phone shows one toast comfortably; past three the stack covers the surface that raised it.
const MAX_VISIBLE = 3;

const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

let items: readonly ToastItem[] = Object.freeze([]);
let nextId = 0;

function publish(next: readonly ToastItem[]): void {
  items = Object.freeze(next);
  listeners.forEach((listener) => {
    listener();
  });
}

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(id);
}

function dismiss(id?: string): void {
  if (id === undefined) {
    timers.forEach((timer) => {
      clearTimeout(timer);
    });
    timers.clear();
    if (items.length > 0) publish([]);
    return;
  }
  const next = items.filter((item) => item.id !== id);
  clearTimer(id);
  if (next.length === items.length) return;
  publish(next);
}

function add(type: ToastType, title: string, options?: ToastOptions): string {
  nextId += 1;
  const id = `honk-toast-${nextId}`;
  const next = [
    ...items,
    {
      id,
      type,
      title,
      ...(options?.description === undefined ? {} : { description: options.description }),
      ...(options?.action === undefined ? {} : { action: options.action }),
    },
  ].slice(-MAX_VISIBLE);
  // Anything pushed off the top of the stack loses its pending timer with it.
  items
    .filter((stale) => !next.includes(stale))
    .forEach((stale) => {
      clearTimer(stale.id);
    });
  publish(next);
  const duration = options?.durationMs ?? (type === "loading" ? 0 : DEFAULT_DURATION_MS);
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => {
        dismiss(id);
      }, duration),
    );
  }
  return id;
}

// An action runs and then takes its toast with it: leaving the toast up implies the work is still
// pending when it is not.
function invokeToastAction(id: string): void {
  const item = items.find((candidate) => candidate.id === id);
  if (item?.action === undefined) return;
  item.action.run();
  dismiss(id);
}

function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getToasts(): readonly ToastItem[] {
  return items;
}

function useToasts(): readonly ToastItem[] {
  return React.useSyncExternalStore(subscribeToasts, getToasts, getToasts);
}

// Sonner-shaped so a shared call site reads the same on both renderers.
const toast = Object.assign(
  (title: string, options?: ToastOptions): string => add("info", title, options),
  {
    success: (title: string, options?: ToastOptions): string => add("success", title, options),
    error: (title: string, options?: ToastOptions): string => add("error", title, options),
    warning: (title: string, options?: ToastOptions): string => add("warning", title, options),
    info: (title: string, options?: ToastOptions): string => add("info", title, options),
    loading: (title: string, options?: ToastOptions): string => add("loading", title, options),
    dismiss,
  },
);

export { getToasts, invokeToastAction, subscribeToasts, toast, useToasts };
export type { ToastAction, ToastItem, ToastOptions, ToastType };
