import { Schema } from "effect";

export const TrimmedString = Schema.Trim;
export const TrimmedNonEmptyString = TrimmedString.check(Schema.isNonEmpty());

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
export const PortSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

/**
 * Construct a branded identifier. Enforces non-empty trimmed strings.
 */
const makeEntityId = <Brand extends string>(brand: Brand) => {
  return TrimmedNonEmptyString.pipe(Schema.brand(brand));
};

export const AuthProviderId = makeEntityId("AuthProviderId");
export type AuthProviderId = typeof AuthProviderId.Type;
export const AccountId = makeEntityId("AccountId");
export type AccountId = typeof AccountId.Type;
export const ModelId = makeEntityId("ModelId");
export type ModelId = typeof ModelId.Type;
export const ThreadId = makeEntityId("ThreadId");
export type ThreadId = typeof ThreadId.Type;
export const ProjectId = makeEntityId("ProjectId");
export type ProjectId = typeof ProjectId.Type;
