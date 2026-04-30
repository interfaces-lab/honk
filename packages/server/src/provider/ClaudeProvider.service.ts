import { Context } from "effect";

import type { ServerProviderShape } from "./ServerProvider.service.ts";

export interface ClaudeProviderShape extends ServerProviderShape {}

export class ClaudeProvider extends Context.Service<ClaudeProvider, ClaudeProviderShape>()(
  "multi/provider/ClaudeProvider.service",
) {}
