import { Context } from "effect";

import type { ServerProviderShape } from "./ServerProvider.service.ts";

export interface AmpProviderShape extends ServerProviderShape {}

export class AmpProvider extends Context.Service<AmpProvider, AmpProviderShape>()(
  "multi/provider/AmpProvider.service",
) {}
