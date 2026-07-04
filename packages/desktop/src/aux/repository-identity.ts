import { spawn } from "node:child_process";
import type { RepositoryIdentity } from "@honk/shared/environment";
import {
	detectGitHostingProviderFromRemoteUrl,
	normalizeGitRemoteUrl,
} from "@honk/shared/git";

const GIT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 1_000_000;
const POSITIVE_CACHE_TTL_MS = 60_000;
const NEGATIVE_CACHE_TTL_MS = 10_000;
const CACHE_CAPACITY = 512;

interface GitResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

interface CacheEntry {
	readonly value: RepositoryIdentity | null;
	readonly expiresAt: number;
}

function appendOutput(current: string, chunk: Buffer | string): string {
	if (current.length >= MAX_OUTPUT_CHARS) {
		return current;
	}
	const next = `${current}${chunk.toString()}`;
	return next.length > MAX_OUTPUT_CHARS ? next.slice(0, MAX_OUTPUT_CHARS) : next;
}

function runGit(cwd: string, args: readonly string[]): Promise<GitResult> {
	return new Promise((resolve) => {
		const child = spawn("git", ["-C", cwd, ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) {
				return;
			}
			child.kill("SIGTERM");
		}, GIT_TIMEOUT_MS);

		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout = appendOutput(stdout, chunk);
		});
		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr = appendOutput(stderr, chunk);
		});
		child.once("error", (error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			resolve({ code: 1, stdout, stderr: error.message });
		});
		child.once("close", (code) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			resolve({ code: code ?? 1, stdout, stderr });
		});
	});
}

function parseRemoteFetchUrls(stdout: string): Map<string, string> {
	const remotes = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			continue;
		}
		const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(trimmed);
		if (!match) {
			continue;
		}
		const remoteName = match[1] ?? "";
		const remoteUrl = match[2] ?? "";
		const direction = match[3] ?? "";
		if (direction !== "fetch" || remoteName.length === 0 || remoteUrl.length === 0) {
			continue;
		}
		remotes.set(remoteName, remoteUrl);
	}
	return remotes;
}

function pickPrimaryRemote(
	remotes: ReadonlyMap<string, string>,
): { readonly remoteName: string; readonly remoteUrl: string } | null {
	for (const preferredRemoteName of ["upstream", "origin"]) {
		const remoteUrl = remotes.get(preferredRemoteName);
		if (remoteUrl) {
			return { remoteName: preferredRemoteName, remoteUrl };
		}
	}

	const entries = [...remotes.entries()].sort(([left], [right]) => left.localeCompare(right));
	const first = entries[0];
	return first ? { remoteName: first[0], remoteUrl: first[1] } : null;
}

function buildRepositoryIdentity(input: {
	readonly remoteName: string;
	readonly remoteUrl: string;
}): RepositoryIdentity {
	const canonicalKey = normalizeGitRemoteUrl(input.remoteUrl);
	const hostingProvider = detectGitHostingProviderFromRemoteUrl(input.remoteUrl);
	const repositoryPath = canonicalKey.split("/").slice(1).join("/");
	const repositoryPathSegments = repositoryPath.split("/").filter((segment) => segment.length > 0);
	const owner = repositoryPathSegments[0];
	const repositoryName = repositoryPathSegments.at(-1);

	return {
		canonicalKey,
		locator: {
			source: "git-remote",
			remoteName: input.remoteName,
			remoteUrl: input.remoteUrl,
		},
		...(repositoryPath ? { displayName: repositoryPath } : {}),
		...(hostingProvider ? { provider: hostingProvider.kind } : {}),
		...(owner ? { owner } : {}),
		...(repositoryName ? { name: repositoryName } : {}),
	};
}

async function resolveRepositoryIdentityCacheKey(cwd: string): Promise<string> {
	try {
		const result = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
		if (result.code !== 0) {
			return cwd;
		}
		const candidate = result.stdout.trim();
		return candidate.length > 0 ? candidate : cwd;
	} catch {
		return cwd;
	}
}

async function resolveRepositoryIdentityFromCacheKey(
	cacheKey: string,
): Promise<RepositoryIdentity | null> {
	try {
		const result = await runGit(cacheKey, ["remote", "-v"]);
		if (result.code !== 0) {
			return null;
		}
		const remote = pickPrimaryRemote(parseRemoteFetchUrls(result.stdout));
		return remote ? buildRepositoryIdentity(remote) : null;
	} catch {
		return null;
	}
}

export class DesktopAuxRepositoryIdentityResolver {
	private readonly cache = new Map<string, CacheEntry>();

	async resolve(cwd: string): Promise<RepositoryIdentity | null> {
		const cacheKey = await resolveRepositoryIdentityCacheKey(cwd);
		const now = Date.now();
		const cached = this.cache.get(cacheKey);
		if (cached && cached.expiresAt > now) {
			return cached.value;
		}

		const value = await resolveRepositoryIdentityFromCacheKey(cacheKey);
		this.cache.set(cacheKey, {
			value,
			expiresAt: now + (value === null ? NEGATIVE_CACHE_TTL_MS : POSITIVE_CACHE_TTL_MS),
		});
		if (this.cache.size > CACHE_CAPACITY) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey) {
				this.cache.delete(oldestKey);
			}
		}
		return value;
	}
}

export function createDesktopAuxRepositoryIdentityResolver(): DesktopAuxRepositoryIdentityResolver {
	return new DesktopAuxRepositoryIdentityResolver();
}
