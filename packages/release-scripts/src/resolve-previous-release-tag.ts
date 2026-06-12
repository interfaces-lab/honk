#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Array, Config, Effect, FileSystem, Stream, String } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

interface StableVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: ReadonlyArray<string>;
}

const parseNumericIdentifier = (identifier: string): number | undefined =>
  /^\d+$/.test(identifier) ? Number(identifier) : undefined;

const comparePrereleaseIdentifiers = (left: string, right: string): number => {
  const leftNumeric = parseNumericIdentifier(left);
  const rightNumeric = parseNumericIdentifier(right);

  if (leftNumeric !== undefined && rightNumeric !== undefined) return leftNumeric - rightNumeric;
  if (leftNumeric !== undefined) return -1;
  if (rightNumeric !== undefined) return 1;
  return left.localeCompare(right);
};

const compareStableVersions = (left: StableVersion, right: StableVersion): number => {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  const leftHasPrerelease = left.prerelease.length > 0;
  const rightHasPrerelease = right.prerelease.length > 0;
  if (!leftHasPrerelease && !rightHasPrerelease) return 0;
  if (!leftHasPrerelease) return 1;
  if (!rightHasPrerelease) return -1;

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;

    const comparison = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }

  return 0;
};

const parseStableTag = (tag: string): StableVersion | undefined => {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag);
  if (!match) return undefined;

  const [, major, minor, patch, prerelease] = match;
  if (!major || !minor || !patch) return undefined;

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ? prerelease.split(".") : [],
  };
};

const resolvePreviousReleaseTag = (
  currentTag: string,
  tags: ReadonlyArray<string>,
): string | undefined => {
  const current = parseStableTag(currentTag);
  if (!current) {
    throw new Error(`Invalid stable release tag '${currentTag}'.`);
  }

  const candidates = tags
    .map((tag) => ({ tag, parsed: parseStableTag(tag) }))
    .filter((entry): entry is { tag: string; parsed: StableVersion } => entry.parsed !== undefined)
    .filter((entry) => compareStableVersions(entry.parsed, current) < 0)
    .toSorted((left, right) => compareStableVersions(right.parsed, left.parsed));

  return candidates[0]?.tag;
};

const listGitTags = Effect.fn("listGitTags")(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make("git", ["tag", "--list"]));
  return yield* child.stdout.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
    Effect.map(String.split(/\r?\n/)),
    Effect.map(Array.map(String.trim)),
    Effect.map(Array.filter(String.isNonEmpty)),
  );
});

const writeOutput = Effect.fn("writeOutput")(function* (
  previousTag: string | undefined,
  writeGithubOutput: boolean,
) {
  const entry = `previous_tag=${previousTag ?? ""}\n`;

  if (writeGithubOutput) {
    const fs = yield* FileSystem.FileSystem;
    const githubOutputPath = yield* Config.nonEmptyString("GITHUB_OUTPUT");
    yield* fs.writeFileString(githubOutputPath, entry, { flag: "a" });
    return;
  }

  process.stdout.write(entry);
});

const command = Command.make(
  "resolve-previous-release-tag",
  {
    currentTag: Flag.string("current-tag").pipe(
      Flag.withDescription("Current release tag to compare against."),
    ),
    githubOutput: Flag.boolean("github-output").pipe(
      Flag.withDescription("Write values to GITHUB_OUTPUT instead of stdout."),
      Flag.withDefault(false),
    ),
  },
  ({ currentTag, githubOutput }) =>
    listGitTags().pipe(
      Effect.map((tags) => resolvePreviousReleaseTag(currentTag, tags)),
      Effect.flatMap((previousTag) => writeOutput(previousTag, githubOutput)),
    ),
).pipe(Command.withDescription("Resolve the previous stable release tag."));

Command.run(command, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
