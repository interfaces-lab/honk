import { Context } from "effect";
import type { Effect, Stream } from "effect";
import type {
  GitManagerServiceError,
  GitStatusInput,
  GitStatusLocalResult,
  GitStatusRemoteResult,
  GitStatusResult,
  GitStatusStreamEvent,
} from "@multi/contracts";

export interface GitStatusBroadcasterShape {
  readonly getStatus: (
    input: GitStatusInput,
  ) => Effect.Effect<GitStatusResult, GitManagerServiceError>;
  readonly refreshLocalStatus: (
    cwd: string,
  ) => Effect.Effect<GitStatusLocalResult, GitManagerServiceError>;
  readonly refreshRemoteStatus: (
    cwd: string,
  ) => Effect.Effect<GitStatusRemoteResult | null, GitManagerServiceError>;
  readonly refreshStatus: (cwd: string) => Effect.Effect<GitStatusResult, GitManagerServiceError>;
  readonly streamStatus: (
    input: GitStatusInput,
  ) => Stream.Stream<GitStatusStreamEvent, GitManagerServiceError>;
}

export class GitStatusBroadcaster extends Context.Service<
  GitStatusBroadcaster,
  GitStatusBroadcasterShape
>()("multi/git/GitStatusBroadcaster.service") {}
