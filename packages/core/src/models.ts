/**
 * Models: the provider catalog and the credentials that unlock it.
 *
 * Pi owns the model runtime. Its `Models` collection resolves request auth,
 * runs serialized OAuth refresh, and streams every provider; its transcript
 * records the selected model as a first-class `model_change` entry. Honk's
 * part is deliberately small (spec section 11): persist credentials so Pi can
 * call a provider, expose the catalog with auth status so settings can render
 * it, and resolve a session's chosen model to a Pi `Model` value.
 *
 * The core maintains no model allowlist, calculates no billing, and never
 * silently moves a session between credentials. Presentation policy — which
 * models to feature, what to name them — belongs to the frontend.
 *
 * @see spec/core.md section 11.
 * @module
 */

import type {
  Api,
  Credential,
  CredentialStore,
  Model,
  MutableModels,
} from "@earendil-works/pi-ai";
import { Context, Effect, Layer, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import type { Workspace } from "./workspace";

/**
 * Names one model in the catalog: Pi's provider id and model id, exactly as
 * the transcript's `model_change` entries record them.
 *
 * A reference rather than the `Model` object on purpose. Clients hold and
 * transmit the two strings; only the core resolves them against the live
 * collection, so a stale or fabricated reference fails typed instead of
 * smuggling an unvetted model into a harness.
 *
 * @category schemas
 */
export const ModelRef = Schema.Struct({
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
}).annotate({ identifier: "ModelRef" });
export type ModelRef = typeof ModelRef.Type;

/**
 * One model as settings render it.
 *
 * @category schemas
 */
export const ModelSummary = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.String,
}).annotate({ identifier: "ModelSummary" });
export type ModelSummary = typeof ModelSummary.Type;

/**
 * One provider with its auth status and current model list.
 *
 * `configured` is Pi's `checkAuth` verdict: the provider has complete auth —
 * a stored credential, an ambient env var, or keyless access. `source` is
 * Pi's human-readable label for where that auth came from ("ANTHROPIC_API_KEY",
 * "OAuth"), for status UI only. `methods` are the ways a user can configure
 * the provider: which entry field or login flow a settings surface should
 * offer. Ambient-only providers list neither.
 *
 * @category schemas
 */
export const ProviderSummary = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.String,
  configured: Schema.Boolean,
  methods: Schema.Array(Schema.Literals(["api_key", "oauth"])),
  authType: Schema.optionalKey(Schema.Literals(["api_key", "oauth"])),
  source: Schema.optionalKey(Schema.String),
  models: Schema.Array(ModelSummary),
}).annotate({ identifier: "ProviderSummary" });
export type ProviderSummary = typeof ProviderSummary.Type;

/**
 * What {@link List} answers: the whole catalog, credentialed or not.
 *
 * Unconfigured providers are listed on purpose — settings must show what
 * *could* be unlocked, not only what already is.
 *
 * @category schemas
 */
export const ListOutput = Schema.Struct({
  providers: Schema.Array(ProviderSummary),
}).annotate({ identifier: "ModelsListOutput" });
export type ListOutput = typeof ListOutput.Type;

/**
 * No provider in the collection carries this id.
 *
 * @category errors
 */
export class UnknownProviderError extends Schema.TaggedErrorClass<UnknownProviderError>()(
  "ModelsUnknownProviderError",
  {
    code: Schema.tag("models.unknown_provider"),
    message: Schema.tag("Honk does not know this provider."),
    providerId: Schema.NonEmptyString,
  },
) {}

/**
 * The provider exists but offers no model with this id.
 *
 * Also the honest answer for a restored session whose recorded model left the
 * catalog: the session names its model, and a core that silently substituted
 * another would move the user's conversation without consent (spec section 11).
 *
 * @category errors
 */
export class UnknownModelError extends Schema.TaggedErrorClass<UnknownModelError>()(
  "ModelsUnknownModelError",
  {
    code: Schema.tag("models.unknown_model"),
    message: Schema.tag("This provider offers no such model."),
    providerId: Schema.NonEmptyString,
    modelId: Schema.NonEmptyString,
  },
) {}

/**
 * No configured provider offers any model.
 *
 * The answer to "give me a default" on a host where nothing is unlocked yet.
 * A product state, not a crash: the client's move is to open settings and add
 * a credential.
 *
 * @category errors
 */
export class NoModelError extends Schema.TaggedErrorClass<NoModelError>()("ModelsNoModelError", {
  code: Schema.tag("models.no_model"),
  message: Schema.tag("No configured provider offers a model."),
}) {}

/**
 * The credential store refused a write.
 *
 * @category errors
 */
export class CredentialError extends Schema.TaggedErrorClass<CredentialError>()(
  "ModelsCredentialError",
  {
    code: Schema.tag("models.credential_failed"),
    message: Schema.tag("Honk could not update this credential."),
    providerId: Schema.NonEmptyString,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/**
 * Every way resolving a model reference can fail.
 *
 * Session commands carry this union: any command may be the first touch of a
 * stored session, and restoring one resolves its recorded model.
 *
 * @category errors
 */
export const ResolveError = Schema.Union([UnknownProviderError, UnknownModelError, NoModelError]);
export type ResolveError = typeof ResolveError.Type;

/**
 * Every expected failure this domain owns.
 *
 * @category errors
 */
export type Error = ResolveError | CredentialError;

/**
 * The catalog with auth status, for settings.
 *
 * @category commands
 */
export const List = Rpc.make("models.list", {
  payload: {},
  success: ListOutput,
});

/**
 * Stores an API key for a provider.
 *
 * The only credential write in version zero. OAuth flows are interactive and
 * provider-owned (Pi's `Models.login` drives them with prompts), so they enter
 * through a host surface, not a wire command.
 *
 * @category commands
 */
export const SetCredential = Rpc.make("models.set_credential", {
  payload: { providerId: Schema.NonEmptyString, key: Schema.NonEmptyString },
  error: Schema.Union([UnknownProviderError, CredentialError]),
});

/**
 * Removes the stored credential for a provider (logout).
 *
 * @category commands
 */
export const DeleteCredential = Rpc.make("models.delete_credential", {
  payload: { providerId: Schema.NonEmptyString },
  error: Schema.Union([UnknownProviderError, CredentialError]),
});

/**
 * The models command group.
 *
 * @category commands
 */
export class Rpcs extends RpcGroup.make(List, SetCredential, DeleteCredential) {}

/**
 * The service the session layer and the RPC handlers share.
 *
 * @category service
 */
export interface Interface {
  /**
   * Pi's collection itself, for harness construction.
   *
   * Sessions hand this to `AgentHarness`, which resolves request auth through
   * it on every model call — so a credential added mid-session applies to the
   * next request without rebuilding anything.
   */
  readonly collection: MutableModels;

  /**
   * Resolves a model reference to the Pi `Model` a harness runs on.
   *
   * Without a reference, the default is the first model of the first
   * configured provider — deliberate policy-free minimalism, because model
   * presentation belongs to the frontend (spec section 11). A client that
   * cares which model runs passes the reference explicitly.
   */
  readonly resolve: (
    ref?: ModelRef,
  ) => Effect.Effect<Model<Api>, UnknownProviderError | UnknownModelError | NoModelError>;

  readonly list: Effect.Effect<ListOutput>;

  readonly setCredential: (input: {
    readonly providerId: string;
    readonly key: string;
  }) => Effect.Effect<void, UnknownProviderError | CredentialError>;

  readonly deleteCredential: (input: {
    readonly providerId: string;
  }) => Effect.Effect<void, UnknownProviderError | CredentialError>;
}

/**
 * What {@link layer} binds together.
 *
 * The collection and the store arrive as a pair because they are already
 * entangled: production builds `builtinModels({ credentials })`, so the
 * collection resolves auth through the same store this service writes. Passing
 * them separately here keeps the faux seam trivial — tests pass a collection
 * whose providers need no credentials at all.
 *
 * @category layers
 */
export interface LayerOptions {
  readonly collection: MutableModels;
  readonly credentials: CredentialStore;
}

/**
 * Builds the models service over a Pi collection and its credential store.
 *
 * The explicit return type breaks the reference cycle with the {@link Service}
 * class that carries it.
 */
const make = (options: LayerOptions): Effect.Effect<Interface> =>
  Effect.sync(() => {
    const { collection, credentials } = options;

    const resolve = Effect.fnUntraced(function* (ref?: ModelRef) {
      if (ref === undefined) {
        const available = yield* Effect.promise(() => collection.getAvailable());
        const first = available[0];
        if (first === undefined) return yield* new NoModelError({});
        return first;
      }
      if (collection.getProvider(ref.providerId) === undefined) {
        return yield* new UnknownProviderError({ providerId: ref.providerId });
      }
      const model = collection.getModel(ref.providerId, ref.modelId);
      if (model === undefined) {
        return yield* new UnknownModelError({ providerId: ref.providerId, modelId: ref.modelId });
      }
      return model;
    });

    const list = Effect.gen(function* () {
      const providers: ProviderSummary[] = [];
      for (const provider of collection.getProviders()) {
        // checkAuth reads stored credentials and ambient env without
        // refreshing OAuth, so listing the catalog never touches a network.
        const check = yield* Effect.promise(() => collection.checkAuth(provider.id));
        // A provider is user-configurable by key entry only when Pi's api-key
        // auth carries a login step; ambient-only providers omit it.
        const methods: ("api_key" | "oauth")[] = [];
        if (provider.auth.apiKey?.login !== undefined) methods.push("api_key");
        if (provider.auth.oauth !== undefined) methods.push("oauth");
        providers.push({
          id: provider.id,
          name: provider.name,
          configured: check !== undefined,
          methods,
          ...(check?.type !== undefined ? { authType: check.type } : {}),
          ...(check?.source !== undefined ? { source: check.source } : {}),
          models: provider.getModels().map((model) => ({ id: model.id, name: model.name })),
        });
      }
      return { providers } satisfies ListOutput;
    });

    const setCredential = Effect.fnUntraced(function* (input: {
      readonly providerId: string;
      readonly key: string;
    }) {
      if (collection.getProvider(input.providerId) === undefined) {
        return yield* new UnknownProviderError({ providerId: input.providerId });
      }
      // `modify` is Pi's only credential write path; going through it keeps
      // this serialized against any OAuth refresh the collection is running.
      yield* Effect.tryPromise({
        try: () =>
          credentials.modify(
            input.providerId,
            (): Promise<Credential | undefined> =>
              Promise.resolve({ type: "api_key", key: input.key }),
          ),
        catch: (cause) => new CredentialError({ providerId: input.providerId, cause }),
      });
    });

    const deleteCredential = Effect.fnUntraced(function* (input: {
      readonly providerId: string;
    }) {
      if (collection.getProvider(input.providerId) === undefined) {
        return yield* new UnknownProviderError({ providerId: input.providerId });
      }
      yield* Effect.tryPromise({
        try: () => collection.logout(input.providerId),
        catch: (cause) => new CredentialError({ providerId: input.providerId, cause }),
      });
    });

    return { collection, resolve, list, setCredential, deleteCredential } satisfies Interface;
  });

/**
 * The service key and its construction, declared together.
 *
 * @category service
 */
export class Service extends Context.Service<Service, Interface>()("honk/Models", { make }) {}

/**
 * Builds the models service.
 *
 * One instance per host: the session layer and the models RPCs must share it,
 * because both must see the same collection the harnesses stream through.
 *
 * @category layers
 */
export const layer = (options: LayerOptions) => Layer.effect(Service, Service.make(options));

/**
 * Binds the models RPCs to {@link Service}.
 *
 * @category layers
 */
export const rpcLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const models = yield* Service;
    return {
      "models.list": () => models.list,
      "models.set_credential": (payload) => models.setCredential(payload),
      "models.delete_credential": (payload) => models.deleteCredential(payload),
    };
  }),
);

/** Where credentials persist, relative to the host data directory. */
const credentialsFile = "auth.json";

/**
 * Pi's `CredentialStore` over the host data directory.
 *
 * One JSON object keyed by provider id — the ecosystem's `auth.json` shape —
 * beside the trust store and the session transcripts, through the same
 * injected environment, so the core stays platform-free.
 *
 * Every operation queues on one promise chain. Pi's contract demands
 * serialized read-modify-write per provider (its `Models.getAuth` runs OAuth
 * refresh inside `modify` and must not double-refresh); one file written
 * whole makes global serialization the simplest correct implementation.
 * Rejections mean storage failure, which Pi surfaces as `ModelsError` with
 * code "auth" — a missing file is not a failure, just an empty store.
 */
export const credentialStore = (storage: Workspace.ExecutionEnv): CredentialStore => {
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const load = async (): Promise<Record<string, Credential>> => {
    const read = await storage.readTextFile(credentialsFile);
    if (!read.ok) {
      if (read.error.code === "not_found") return {};
      throw read.error;
    }
    return JSON.parse(read.value) as Record<string, Credential>;
  };

  const store = async (map: Record<string, Credential>): Promise<void> => {
    const written = await storage.writeFile(credentialsFile, `${JSON.stringify(map, null, 2)}\n`);
    if (!written.ok) throw written.error;
  };

  return {
    read: (providerId) => enqueue(async () => (await load())[providerId]),
    list: () =>
      enqueue(async () =>
        Object.entries(await load()).map(([providerId, credential]) => ({
          providerId,
          type: credential.type,
        })),
      ),
    modify: (providerId, fn) =>
      enqueue(async () => {
        const map = await load();
        const current = map[providerId];
        const next = await fn(current);
        if (next === undefined) return current;
        map[providerId] = next;
        await store(map);
        return next;
      }),
    delete: (providerId) =>
      enqueue(async () => {
        const map = await load();
        if (!(providerId in map)) return;
        delete map[providerId];
        await store(map);
      }),
  };
};

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Models from "./models";
