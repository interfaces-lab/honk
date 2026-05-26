import { Context } from "effect";

import type { ServerProviderShape } from "./ServerProvider.service.ts";

export interface CursorSdkProviderShape extends ServerProviderShape {}

export class CursorSdkProvider extends Context.Service<CursorSdkProvider, CursorSdkProviderShape>()(
  "multi/provider/CursorSdkProvider.service",
) {}
