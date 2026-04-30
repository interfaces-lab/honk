import { Context } from "effect";

import type { ServerProviderShape } from "./ServerProvider.service.ts";

export interface OpenCodeProviderShape extends ServerProviderShape {}

export class OpenCodeProvider extends Context.Service<OpenCodeProvider, OpenCodeProviderShape>()(
  "t3/provider/OpenCodeProvider.service",
) {}
