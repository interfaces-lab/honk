import { Context } from "effect";
import type { Effect, Stream } from "effect";
import type {
  GitManagerServiceError,
  GitStatusInput,
  GitStatusResult,
  GitStatusStreamEvent,
} from "@honk/contracts";

export interface GitStatusBroadcasterShape {
  readonly refreshStatus: (
    input: GitStatusInput,
  ) => Effect.Effect<GitStatusResult, GitManagerServiceError>;
  readonly streamStatus: (
    input: GitStatusInput,
  ) => Stream.Stream<GitStatusStreamEvent, GitManagerServiceError>;
}

export class GitStatusBroadcaster extends Context.Service<
  GitStatusBroadcaster,
  GitStatusBroadcasterShape
>()("honk/git/GitStatusBroadcaster.service") {}
