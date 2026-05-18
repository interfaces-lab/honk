import { ProviderDriverKind } from "@multi/contracts";
import { Context } from "effect";

import type { ProviderAdapterError } from "./Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.service.ts";

export interface AmpAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: ProviderDriverKind;
}

export class AmpAdapter extends Context.Service<AmpAdapter, AmpAdapterShape>()(
  "multi/provider/AmpAdapter.service",
) {}
