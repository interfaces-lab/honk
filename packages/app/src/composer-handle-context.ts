import { createContext, useContext, type MutableRefObject } from "react";
import type { ChatComposerHandle } from "./components/chat/chat-composer";

export type ComposerHandleRef = MutableRefObject<ChatComposerHandle | null>;

export const ComposerHandleContext = createContext<ComposerHandleRef | null>(null);

export function useComposerHandleContext(): ComposerHandleRef | null {
  return useContext(ComposerHandleContext);
}
