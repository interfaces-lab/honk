import { Context } from "effect";

import type { ServerProviderShape } from "./ServerProvider.service.ts";

export interface CodexProviderShape extends ServerProviderShape {}

export class CodexProvider extends Context.Service<CodexProvider, CodexProviderShape>()(
  "multi/provider/CodexProvider.service",
) {}
