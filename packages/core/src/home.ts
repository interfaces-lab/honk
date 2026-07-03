import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The Core claims `<HONK_HOME>/core/` — a fresh subdirectory that cannot
 * collide with the legacy store (`userdata/state.sqlite` and its migration
 * history), per the ADR 0009 clean break. Harnesses get sibling spaces under
 * `<HONK_HOME>/harness/`: the pi Harness is hermetic there (ADR 0017) — its
 * agentDir, session JSONL, models.json, and debug logs never touch the user's
 * ~/.pi/agent. Resolution order matches the rest of the product: explicit
 * override, then HONK_HOME, then `~/.honk`.
 */
export interface CoreHome {
	readonly root: string;
	readonly coreDir: string;
	readonly dbPath: string;
	readonly discoveryPath: string;
	readonly attachmentsDir: string;
	/** The secret store — pi's auth.json format, 0600 + file-locked (ADR 0009/0016). */
	readonly authPath: string;
	/** The pi Harness's hermetic config space (ADR 0017): agentDir, sessions, models.json, debug logs. */
	readonly piDir: string;
	/** The Claude Code Harness's honk-owned corner (ADR 0018) — debug logs only; auth and sessions ride the user's ~/.claude. */
	readonly claudeDir: string;
	/** The Cursor Harness's isolated HOME (ADR 0016): the ACP child must never see the user's `agent login` state — CURSOR_API_KEY is the only credential. */
	readonly cursorDir: string;
}

export const resolveCoreHome = (override?: string): CoreHome => {
	const root = override ?? process.env["HONK_HOME"] ?? join(homedir(), ".honk");
	const coreDir = join(root, "core");
	return {
		root,
		coreDir,
		dbPath: join(coreDir, "core.sqlite"),
		discoveryPath: join(coreDir, "core.json"),
		attachmentsDir: join(coreDir, "attachments"),
		authPath: join(coreDir, "auth.json"),
		piDir: join(root, "harness", "pi"),
		claudeDir: join(root, "harness", "claude-code"),
		cursorDir: join(root, "harness", "cursor"),
	};
};
