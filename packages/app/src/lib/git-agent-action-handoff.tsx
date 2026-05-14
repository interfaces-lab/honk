import { createContext, useContext } from "react";

import type { ChatMessage } from "~/types";
import type { GitAgentRun } from "./git-agent-actions";

export type GitAgentActionHandoff = GitAgentRun & {
  optimisticMessage: ChatMessage;
};

export const GitAgentActionHandoffContext = createContext<GitAgentActionHandoff | null>(null);

export function useGitAgentActionHandoff(): GitAgentActionHandoff | null {
  return useContext(GitAgentActionHandoffContext);
}
