import { createContext, useContext, type RefObject } from "react";
import type { ComposerInputHandle } from "./input";

export type ComposerHandleRef = RefObject<ComposerInputHandle | null>;

export const ComposerHandleContext = createContext<ComposerHandleRef | null>(null);

export function useComposerHandleContext(): ComposerHandleRef | null {
  return useContext(ComposerHandleContext);
}
