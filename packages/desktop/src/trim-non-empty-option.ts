import * as Option from "effect/Option";

const trimNonEmptyOption = (value: string | null | undefined): Option.Option<string> =>
  Option.fromNullishOr(value).pipe(
    Option.map((entry) => entry.trim()),
    Option.filter((entry) => entry.length > 0),
  );

export { trimNonEmptyOption };
