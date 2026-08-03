// Playwright's selector runtime, embedded at build time by electron.vite.config.ts.
// Nothing is read from disk here, so playwright-core stays out of the shipped app.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

// Replaced by electron.vite.config.ts at build time.
declare const __HONK_PLAYWRIGHT_INJECTED_SOURCE__: string;

const encodeUnknownJson = Schema.encodeUnknownEffect(Schema.UnknownFromJsonString);

export class PlaywrightInjectedRuntimeError extends Data.TaggedError(
  "PlaywrightInjectedRuntimeError",
)<{
  readonly operation: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `Playwright injected runtime operation failed: ${this.operation}`;
  }
}

const fail = (operation: string, cause: unknown) =>
  new PlaywrightInjectedRuntimeError({ operation, cause });

export const playwrightInjectedRuntimeSource = Effect.fn(
  "browser.playwrightInjectedRuntime.source",
)(function* () {
  const source: unknown = __HONK_PLAYWRIGHT_INJECTED_SOURCE__;
  if (typeof source !== "string" || source.length < 100_000) {
    return yield* fail(
      "validateSource",
      new Error("Playwright injected runtime source was not embedded at build time."),
    );
  }
  return source;
});

export const playwrightInjectedRuntimeInstallExpression = Effect.fn(
  "browser.playwrightInjectedRuntime.installExpression",
)(function* () {
  const source = yield* playwrightInjectedRuntimeSource();
  const options = yield* encodeUnknownJson({
    isUnderTest: false,
    sdkLanguage: "javascript",
    testIdAttributeName: "data-testid",
    stableRafCount: 1,
    browserName: "chromium",
    shouldPrependErrorPrefix: false,
    isUtilityWorld: false,
    customEngines: [],
  }).pipe(Effect.mapError((cause) => fail("encodeOptions", cause)));
  return `(() => {
    if (globalThis.__honkPlaywrightInjected) return true;
    const module = { exports: {} };
    ${source}
    globalThis.__honkPlaywrightInjected = new (module.exports.InjectedScript())(globalThis, ${options});
    return true;
  })()`;
});
