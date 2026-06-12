import type { MessageId } from "@honk/contracts";

import type { GitAgentRun } from "./git-agent-actions";

export type GitAgentActionHandoff = GitAgentRun & {
  messageId: MessageId;
};
