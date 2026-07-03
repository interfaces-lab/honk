import { Schema } from "effect";
import { CredentialKind, HarnessId } from "./model";
import { IsoTimestamp, strictDecode, TrimmedNonEmptyString } from "./primitives";

export const CredentialState = Schema.Literals(["missing", "available", "expired", "error"]);
export type CredentialState = typeof CredentialState.Type;

/**
 * One row per honk-stored credential; only fields the settings UI actually
 * renders survive (label = account hint, message = row detail). Anthropic has
 * no row here — its auth is delegated and renders from the claude-code
 * HarnessStatus probe (ADR 0016).
 */
export const CredentialStatus = Schema.Struct({
	kind: CredentialKind,
	state: CredentialState,
	label: Schema.NullOr(TrimmedNonEmptyString),
	message: Schema.NullOr(Schema.String),
	updatedAt: IsoTimestamp,
});
export type CredentialStatus = typeof CredentialStatus.Type;

/**
 * The one in-flight OAuth login (the Core runs at most one; Codex OAuth is
 * the only kind that flows — the api-key kind resolves inline). Device-code
 * vs browser flow is carried by field presence: `userCode` set means
 * show-code-and-copy; otherwise `verificationUri` is open-in-browser.
 * Success is expressed by the flow clearing to null on the next snapshot.
 */
export const LoginFlow = Schema.Struct({
	kind: Schema.Literal("codex-oauth"),
	state: Schema.Literals(["pending", "error"]),
	message: Schema.NullOr(Schema.String),
	verificationUri: Schema.NullOr(Schema.String),
	userCode: Schema.NullOr(Schema.String),
	updatedAt: IsoTimestamp,
});
export type LoginFlow = typeof LoginFlow.Type;

/**
 * Harness liveness from the zero-token probes (Claude init IPC, Cursor ACP
 * authenticate, pi in-process). The claude-code probe doubles as Anthropic's
 * auth surface: `detail` carries the derived login label ("Max subscription ·
 * user@…" / "API key"), the t3code pattern (ADR 0016).
 */
export const HarnessStatus = Schema.Struct({
	harness: HarnessId,
	available: Schema.Boolean,
	detail: Schema.NullOr(Schema.String),
});
export type HarnessStatus = typeof HarnessStatus.Type;

export const AuthSnapshot = Schema.Struct({
	credentials: Schema.Array(CredentialStatus),
	harnesses: Schema.Array(HarnessStatus),
	flow: Schema.NullOr(LoginFlow),
});
export type AuthSnapshot = typeof AuthSnapshot.Type;

/** Impossible logins are unrepresentable: OAuth carries nothing (a background flow starts); the api-key kind requires the key inline. */
export const LoginInput = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("codex-oauth") }),
	Schema.Struct({ kind: Schema.Literal("cursor-api-key"), apiKey: TrimmedNonEmptyString }),
]);
export type LoginInput = typeof LoginInput.Type;

export const decodeAuthSnapshot = strictDecode(AuthSnapshot);
export const decodeLoginFlow = strictDecode(LoginFlow);
