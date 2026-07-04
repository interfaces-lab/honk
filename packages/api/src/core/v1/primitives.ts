import { Schema } from "effect";

export const TrimmedNonEmptyString = Schema.Trim.check(Schema.isNonEmpty());
export type TrimmedNonEmptyString = typeof TrimmedNonEmptyString.Type;

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export type NonNegativeInt = typeof NonNegativeInt.Type;

/**
 * Open-world record. `Schema.UnknownRecord` does not exist in effect beta.59.
 * One of the sanctioned open sites (tool `input`, `custom.payload`,
 * `metadata`, question `answers`); everything else decodes fail-closed.
 */
export const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);
export type UnknownRecord = typeof UnknownRecord.Type;

/**
 * ISO-8601-validated timestamp string. beta.59 ships no built-in that keeps
 * the decoded type a `string` (`DateTimeUtcFromString` transforms into
 * `DateTime.Utc`), so this is a permissive filter: leading `YYYY-MM-DD` shape
 * plus a `Date.parse` sanity check.
 */
export const IsoTimestamp = Schema.String.check(
	Schema.makeFilter(
		(value: string) =>
			(/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) ||
			"must be an ISO-8601 timestamp",
	),
);
export type IsoTimestamp = typeof IsoTimestamp.Type;

export const TokenUsage = Schema.Struct({
	inputTokens: Schema.optional(Schema.Number),
	outputTokens: Schema.optional(Schema.Number),
	cacheReadTokens: Schema.optional(Schema.Number),
	cacheWriteTokens: Schema.optional(Schema.Number),
	totalTokens: Schema.optional(Schema.Number),
});
export type TokenUsage = typeof TokenUsage.Type;

/**
 * Fail-closed decoder factory. Effect Schema strips unmodeled keys by default
 * (`onExcessProperty: "ignore"`), which would silently accept drifted
 * payloads. beta.59 requires the ParseOptions at the CALL site — passing them
 * at the binding site (`decodeUnknownSync(schema, options)`) silently ignores
 * them. `onExcessProperty: "error"` recurses into nested unions and structs.
 */
export const strictDecode = <S extends Schema.Decoder<unknown>>(
	schema: S,
): ((input: unknown) => S["Type"]) => {
	const decode = Schema.decodeUnknownSync(schema);
	return (input) => decode(input, { onExcessProperty: "error" });
};
