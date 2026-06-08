import type { MessageId } from "@multi/contracts";

import type { GitAgentRun } from "./git-agent-actions";

export type GitAgentActionHandoff = GitAgentRun & {
  messageId: MessageId;
};
