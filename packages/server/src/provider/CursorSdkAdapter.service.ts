import { ProviderDriverKind } from "@multi/contracts";
import { Context } from "effect";

import type { ProviderAdapterError } from "./Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.service.ts";

export interface CursorSdkAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: ProviderDriverKind;
}

export class CursorSdkAdapter extends Context.Service<
  CursorSdkAdapter,
  CursorSdkAdapterShape
>()("multi/provider/CursorSdkAdapter.service") {}
