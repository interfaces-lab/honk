import { Option, Schema } from "effect";

/**
 * The machine-level discovery file (ADR 0002): a Core App or SDK reads this,
 * probes `origin + /core/v1/health`, and attaches instead of starting a
 * second Core. Liveness is the HTTP probe, never the pid.
 */
export const CoreDiscovery = Schema.Struct({
	version: Schema.Literal(2),
	apiVersion: Schema.Literal("core/v1"),
	pid: Schema.Int,
	port: Schema.Int,
	origin: Schema.String,
	startedAt: Schema.String,
});
export type CoreDiscovery = typeof CoreDiscovery.Type;

const CoreDiscoveryJson = Schema.fromJsonString(CoreDiscovery);
const decodeCoreDiscoveryOption = Schema.decodeUnknownOption(CoreDiscoveryJson);

export const encodeCoreDiscovery = Schema.encodeSync(CoreDiscoveryJson);

export const decodeCoreDiscoveryText = (text: string): Option.Option<CoreDiscovery> =>
	decodeCoreDiscoveryOption(text);
