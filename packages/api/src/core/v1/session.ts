import { Context, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi";
import { SessionId } from "./id";
import { IsoTimestamp, strictDecode, TrimmedNonEmptyString } from "./primitives";

export const SessionRole = Schema.Literals(["core-app", "web"]);
export type SessionRole = typeof SessionRole.Type;

export const Session = Schema.Struct({
	id: SessionId,
	role: SessionRole,
	label: Schema.NullOr(TrimmedNonEmptyString),
	createdAt: IsoTimestamp,
	expiresAt: Schema.NullOr(IsoTimestamp),
	lastSeenAt: Schema.NullOr(IsoTimestamp),
});
export type Session = typeof Session.Type;

export const PairingIssue = Schema.Struct({
	token: TrimmedNonEmptyString,
	url: TrimmedNonEmptyString,
	expiresAt: IsoTimestamp,
});
export type PairingIssue = typeof PairingIssue.Type;

export const SessionGrant = Schema.Struct({
	bearer: TrimmedNonEmptyString,
	session: Session,
});
export type SessionGrant = typeof SessionGrant.Type;

export class UnauthorizedError extends Schema.TaggedErrorClass<UnauthorizedError>()(
	"UnauthorizedError",
	{},
	{ httpApiStatus: 401 },
) {
	override get message(): string {
		return "Missing, invalid, or expired session bearer";
	}
}

export class CurrentSession extends Context.Service<CurrentSession, Session>()(
	"@honk/api/core/v1/CurrentSession",
) {}

export class SessionAuth extends HttpApiMiddleware.Service<SessionAuth, { provides: CurrentSession }>()(
	"@honk/api/core/v1/SessionAuth",
	{
		error: UnauthorizedError,
		security: { bearer: HttpApiSecurity.bearer },
	},
) {}

export const decodeSessionRole = strictDecode(SessionRole);
export const decodeSession = strictDecode(Session);
export const decodePairingIssue = strictDecode(PairingIssue);
export const decodeSessionGrant = strictDecode(SessionGrant);
