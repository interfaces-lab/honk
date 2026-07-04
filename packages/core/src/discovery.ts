import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Option } from "effect";
import {
	type CoreDiscovery as ApiCoreDiscovery,
	CoreDiscovery as ApiCoreDiscoverySchema,
	decodeCoreDiscoveryText,
	decodeCoreHealth,
	encodeCoreDiscovery,
} from "@honk/api/core/v1";

export const CoreDiscovery = ApiCoreDiscoverySchema;
export type CoreDiscovery = ApiCoreDiscovery;

export const readDiscovery = (path: string): Option.Option<CoreDiscovery> => {
	try {
		return decodeCoreDiscoveryText(readFileSync(path, "utf8"));
	} catch {
		return Option.none();
	}
};

/** Atomic write: temp file beside the target, then rename. */
export const writeDiscovery = (path: string, state: CoreDiscovery): void => {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = join(dirname(path), `.core.json.${state.pid}.${Date.now()}.tmp`);
	writeFileSync(tmp, `${encodeCoreDiscovery(state)}\n`, "utf8");
	renameSync(tmp, path);
};

/**
 * Exclusive claim (O_EXCL) — the single-instance arbitration ADR 0002
 * demands. Probe-then-write alone is a TOCTOU race: two Cores starting
 * simultaneously would both pass the probe. Returns "claimed" on success or
 * the surviving competitor's state when the file already exists.
 */
export const claimDiscovery = (
	path: string,
	state: CoreDiscovery,
): { readonly _tag: "claimed" } | { readonly _tag: "lost"; readonly existing: Option.Option<CoreDiscovery> } => {
	mkdirSync(dirname(path), { recursive: true });
	try {
		writeFileSync(path, `${encodeCoreDiscovery(state)}\n`, { encoding: "utf8", flag: "wx" });
		return { _tag: "claimed" };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			return { _tag: "lost", existing: readDiscovery(path) };
		}
		throw error;
	}
};

export const clearDiscovery = (path: string): void => {
	rmSync(path, { force: true });
};

/** Clear only our own claim — a losing Core must never delete the survivor's file. */
export const clearDiscoveryIfOwn = (path: string, pid: number): void => {
	const state = readDiscovery(path);
	if (Option.isSome(state) && state.value.pid === pid) {
		rmSync(path, { force: true });
	}
};

const describeError = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** HTTP liveness probe against the health endpoint; clears the file when stale. */
export const probeCore = async (
	path: string,
	timeoutMs = 1000,
): Promise<Option.Option<CoreDiscovery>> => {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return Option.none();
	}
	const state = decodeCoreDiscoveryText(text);
	if (Option.isNone(state)) {
		console.warn("core discovery decode failed; clearing stale discovery file", { path });
		clearDiscovery(path);
		return Option.none();
	}
	try {
		const response = await fetch(`${state.value.origin}/core/v1/health`, {
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) {
			console.warn("core discovery handshake failed; clearing stale discovery file", {
				path,
				origin: state.value.origin,
				status: response.status,
			});
			clearDiscovery(path);
			return Option.none();
		}
		const health = decodeCoreHealth(await response.json());
		if (health.apiVersion === "core/v1") return state;
	} catch (error) {
		console.warn("core discovery handshake failed; clearing stale discovery file", {
			path,
			origin: state.value.origin,
			error: describeError(error),
		});
	}
	// A stale discovery claim would make the next exclusive claim fail even though no live Core answered.
	clearDiscovery(path);
	return Option.none();
};
