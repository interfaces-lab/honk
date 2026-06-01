import type { ScopedThreadRef } from "@multi/contracts";

export const initialMaxVisible = 5;
export const pageStep = 8;
export const nearViewportPrefetchLimit = 12;
export const sidebarThreadPrewarmLimit = 10;
export const EMPTY_VISIBLE_THREAD_REFS: readonly ScopedThreadRef[] = [];

