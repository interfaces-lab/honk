import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { realpathSync, watch, type FSWatcher } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Option, Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "@honk/shared/base-schemas";
import {
  GitCommandError,
  GitHubCliError,
  GitManagerError,
  type GitActionProgressEvent,
  type GitActionProgressPhase,
  type GitBranch,
  type GitCheckoutInput,
  type GitCheckoutResult,
  type GitCreateBranchInput,
  type GitCreateBranchResult,
  type GitCreateWorktreeInput,
  type GitCreateWorktreeResult,
  type GitDiscardPathsInput,
  type GitFileImageInput,
  type GitFileImageResult,
  type GitFilePatchInput,
  type GitFilePatchResult,
  type GitListBranchesInput,
  type GitListBranchesResult,
  type GitNonTextFileType,
  type GitPreparePullRequestThreadInput,
  type GitPreparePullRequestThreadResult,
  type GitPullInput,
  type GitPullRequestRefInput,
  type GitPullResult,
  type GitRemoveWorktreeInput,
  type GitResolvePullRequestResult,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type GitStackedAction,
  type GitStatusInput,
  type GitStatusLocalResult,
  type GitStatusRemoteResult,
  type GitStatusResult,
  type GitStatusStreamEvent,
  type GitWorkingTreeFileStatus,
} from "@honk/shared/git";
import {
	dedupeRemoteBranchesWithLocalMatches,
	detectGitHostingProviderFromRemoteUrl,
	mergeGitStatusParts,
	resolveAutoFeatureBranchName,
	sanitizeBranchFragment,
	sanitizeFeatureBranchName,
} from "@honk/shared/git";
import { normalizePathSeparators } from "@honk/shared/paths";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const OUTPUT_TRUNCATED_MARKER = "\n\n[truncated]";
const PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES = 49_000;
const RANGE_COMMIT_SUMMARY_MAX_OUTPUT_BYTES = 19_000;
const RANGE_DIFF_SUMMARY_MAX_OUTPUT_BYTES = 19_000;
const RANGE_DIFF_PATCH_MAX_OUTPUT_BYTES = 59_000;
const GIT_FILE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const GIT_LIST_BRANCHES_DEFAULT_LIMIT = 100;
const COMMIT_TIMEOUT_MS = 10 * 60_000;
const MAX_PROGRESS_TEXT_LENGTH = 500;
const SHORT_SHA_LENGTH = 7;
const TOAST_DESCRIPTION_MAX = 72;
const STATUS_RESULT_CACHE_TTL_MS = 1_000;
const STATUS_LATEST_PR_CACHE_TTL_MS = 2 * 60_000;
const STATUS_UPSTREAM_REFRESH_INTERVAL_MS = 15_000;
const STATUS_UPSTREAM_REFRESH_TIMEOUT_MS = 5_000;
const STATUS_UPSTREAM_REFRESH_FAILURE_COOLDOWN_MS = 5_000;
const GIT_STATUS_REFRESH_INTERVAL_MS = 30_000;
const GIT_STATUS_LOCAL_WATCH_DEBOUNCE_MS = 1_000;
const GIT_STATUS_LOCAL_WATCH_COOLDOWN_MS = 5_000;
const GIT_STATUS_REFRESH_FAILURE_BASE_DELAY_MS = 30_000;
const GIT_STATUS_REFRESH_FAILURE_MAX_DELAY_MS = 15 * 60_000;
const DEFAULT_BASE_BRANCH_CANDIDATES = ["main", "master"] as const;
const PROJECT_GIT_HARDENED_CONFIG_ARGS = [
	"-c",
	"core.fsmonitor=false",
	"-c",
	"core.untrackedCache=false",
] as const;
const GIT_LITERAL_PATHSPECS_ARG = "--literal-pathspecs";
const PROJECT_GIT_HARDENED_LITERAL_PATHSPECS_ARGS = [
	...PROJECT_GIT_HARDENED_CONFIG_ARGS,
	GIT_LITERAL_PATHSPECS_ARG,
] as const;

const IMAGE_MEDIA_TYPES_BY_EXTENSION: Record<string, string> = {
	avif: "image/avif",
	bmp: "image/bmp",
	gif: "image/gif",
	heic: "image/heic",
	heif: "image/heif",
	ico: "image/x-icon",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	tif: "image/tiff",
	tiff: "image/tiff",
	webp: "image/webp",
};
const IMAGE_FILE_EXTENSIONS = new Set(Object.keys(IMAGE_MEDIA_TYPES_BY_EXTENSION));
const VIDEO_FILE_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm"]);
const AUDIO_FILE_EXTENSIONS = new Set(["aac", "aiff", "flac", "m4a", "mp3", "ogg", "wav"]);
const ARCHIVE_FILE_EXTENSIONS = new Set([
	"7z",
	"br",
	"bz2",
	"dmg",
	"gz",
	"rar",
	"tar",
	"tgz",
	"xz",
	"zip",
]);
const DOCUMENT_FILE_EXTENSIONS = new Set([
	"doc",
	"docx",
	"key",
	"numbers",
	"pages",
	"pdf",
	"ppt",
	"pptx",
	"xls",
	"xlsx",
]);
const FONT_FILE_EXTENSIONS = new Set(["eot", "otf", "ttc", "ttf", "woff", "woff2"]);

export interface DesktopAuxGitOptions {
	readonly worktreesDir: string;
	readonly tmpDir?: string;
}

export interface ExecuteGitInput {
	readonly operation: string;
	readonly cwd: string;
	readonly args: ReadonlyArray<string>;
	readonly stdin?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly allowNonZeroExit?: boolean;
	readonly timeoutMs?: number;
	readonly maxOutputBytes?: number;
	readonly truncateOutputAtMaxBytes?: boolean;
	readonly progress?: ExecuteGitProgress;
}

export interface ExecuteGitResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly stdoutTruncated: boolean;
	readonly stderrTruncated: boolean;
}

export interface ExecuteGitProgress {
	readonly onStdoutLine?: (line: string) => void;
	readonly onStderrLine?: (line: string) => void;
}

interface GitStatusDetails extends Omit<GitStatusResult, "pr" | "hostingProvider"> {
	readonly upstreamRef: string | null;
}

interface GitPreparedCommitContext {
	readonly stagedSummary: string;
	readonly stagedPatch: string;
}

interface GitPushResult {
	readonly status: "pushed" | "skipped_up_to_date";
	readonly branch: string;
	readonly upstreamBranch?: string;
	readonly setUpstream?: boolean;
}

interface GitRangeContext {
	readonly commitSummary: string;
	readonly diffSummary: string;
	readonly diffPatch: string;
}

interface GitHubPullRequestSummary {
	readonly number: number;
	readonly title: string;
	readonly url: string;
	readonly baseRefName: string;
	readonly headRefName: string;
	readonly state?: "open" | "closed" | "merged";
	readonly updatedAt?: string | null;
	readonly isCrossRepository?: boolean;
	readonly headRepositoryNameWithOwner?: string | null;
	readonly headRepositoryOwnerLogin?: string | null;
}

interface GitHubRepositoryCloneUrls {
	readonly nameWithOwner: string;
	readonly url: string;
	readonly sshUrl: string;
}

interface PullRequestHeadRemoteInfo {
	readonly isCrossRepository?: boolean;
	readonly headRepositoryNameWithOwner?: string | null;
	readonly headRepositoryOwnerLogin?: string | null;
}

interface ResolvedPullRequest {
	readonly number: number;
	readonly title: string;
	readonly url: string;
	readonly baseBranch: string;
	readonly headBranch: string;
	readonly state: "open" | "closed" | "merged";
}

interface PullRequestInfo extends PullRequestHeadRemoteInfo {
	readonly number: number;
	readonly title: string;
	readonly url: string;
	readonly baseRefName: string;
	readonly headRefName: string;
	readonly state: "open" | "closed" | "merged";
	readonly updatedAt: string | null;
}

interface BranchHeadContext {
	readonly localBranch: string;
	readonly headBranch: string;
	readonly headSelectors: ReadonlyArray<string>;
	readonly preferredHeadSelector: string;
	readonly remoteName: string | null;
	readonly headRepositoryNameWithOwner: string | null;
	readonly headRepositoryOwnerLogin: string | null;
	readonly isCrossRepository: boolean;
}

interface WorkingTreeChangeFlags {
	readonly staged: boolean;
	readonly unstaged: boolean;
}

interface CachedValue<T> {
	readonly fingerprint: string;
	readonly value: T;
	readonly expiresAt: number;
}

interface CachedGitStatus {
	readonly local: CachedValue<GitStatusLocalResult> | null;
	readonly remote: CachedValue<GitStatusRemoteResult | null> | null;
}

interface ActiveRemotePoller {
	subscriberCount: number;
	timer: NodeJS.Timeout | null;
	stopped: boolean;
	consecutiveFailures: number;
}

interface ActiveLocalWatcher {
	subscriberCount: number;
	watcher: FSWatcher | null;
	timer: NodeJS.Timeout | null;
	cooldownTimer: NodeJS.Timeout | null;
	cooling: boolean;
	pending: boolean;
}

type GitStatusListener = (event: GitStatusStreamEvent) => void;
type StripProgressContext<T> = T extends unknown ? Omit<T, "actionId" | "cwd" | "action"> : never;
type GitActionProgressPayload = StripProgressContext<GitActionProgressEvent>;
type GitActionProgressReporter = (event: GitActionProgressEvent) => void;

const NON_REPOSITORY_STATUS_DETAILS: GitStatusDetails = Object.freeze({
	isRepo: false,
	hasOriginRemote: false,
	isDefaultBranch: false,
	branch: null,
	upstreamRef: null,
	hasWorkingTreeChanges: false,
	workingTree: { files: [], insertions: 0, deletions: 0 },
	hasUpstream: false,
	aheadCount: 0,
	behindCount: 0,
});

function commandLabel(command: string, args: readonly string[]): string {
	return `${command} ${args.join(" ")}`;
}

function gitCommandLabel(args: readonly string[]): string {
	return commandLabel("git", args);
}

function gitCommandError(
	operation: string,
	cwd: string,
	args: readonly string[],
	detail: string,
	cause?: unknown,
): GitCommandError {
	return new GitCommandError({
		operation,
		command: gitCommandLabel(args),
		cwd,
		detail,
		...(cause !== undefined ? { cause } : {}),
	});
}

function gitHubCliError(operation: string, detail: string, cause?: unknown): GitHubCliError {
	return new GitHubCliError({
		operation,
		detail,
		...(cause !== undefined ? { cause } : {}),
	});
}

function gitManagerError(operation: string, detail: string, cause?: unknown): GitManagerError {
	return new GitManagerError({
		operation,
		detail,
		...(cause !== undefined ? { cause } : {}),
	});
}

function isMissingGitCwdError(error: GitCommandError): boolean {
	const normalized = `${error.detail}\n${error.message}`.toLowerCase();
	return (
		normalized.includes("no such file or directory") ||
		normalized.includes("enoent") ||
		normalized.includes("not a directory")
	);
}

function isNotGitRepositoryError(error: GitCommandError): boolean {
	const normalized = `${error.detail}\n${error.message}`.toLowerCase();
	return normalized.includes("not a git repository");
}

function parseBranchAb(value: string): { ahead: number; behind: number } {
	const match = value.match(/^\+(\d+)\s+-(\d+)$/);
	return {
		ahead: Number.parseInt(match?.[1] ?? "0", 10) || 0,
		behind: Number.parseInt(match?.[2] ?? "0", 10) || 0,
	};
}

function parseNumstatCounts(
	addedRaw: string | undefined,
	deletedRaw: string | undefined,
): { insertions: number; deletions: number } {
	const added = Number.parseInt(addedRaw ?? "0", 10);
	const deleted = Number.parseInt(deletedRaw ?? "0", 10);
	return {
		insertions: Number.isFinite(added) ? added : 0,
		deletions: Number.isFinite(deleted) ? deleted : 0,
	};
}

function splitNullSeparatedPaths(input: string, truncated: boolean): string[] {
	const parts = input.split("\0");
	if (truncated && parts[parts.length - 1]?.length) {
		parts.pop();
	}
	return parts.filter((value) => value.length > 0);
}

function parseNullTerminatedNumstatEntries(
	stdout: string,
): Array<{ path: string; insertions: number; deletions: number }> {
	const entries: Array<{ path: string; insertions: number; deletions: number }> = [];
	const records = splitNullSeparatedPaths(stdout, false);
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index] ?? "";
		const [addedRaw, deletedRaw, ...pathParts] = record.split("\t");
		if (addedRaw === undefined || deletedRaw === undefined || pathParts.length === 0) {
			continue;
		}
		let pathValue = pathParts.join("\t");
		if (pathValue.length === 0) {
			const renamedPath = records[index + 2];
			if (!renamedPath) {
				continue;
			}
			pathValue = renamedPath;
			index += 2;
		}
		entries.push({ path: pathValue, ...parseNumstatCounts(addedRaw, deletedRaw) });
	}
	return entries;
}

function parseTextNumstatEntries(
	stdout: string,
): Array<{ path: string; insertions: number; deletions: number }> {
	const entries: Array<{ path: string; insertions: number; deletions: number }> = [];
	for (const line of stdout.split(/\r?\n/g)) {
		if (line.trim().length === 0) {
			continue;
		}
		const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
		const rawPath = pathParts.join("\t").trim();
		if (rawPath.length === 0) {
			continue;
		}
		entries.push({ path: rawPath, ...parseNumstatCounts(addedRaw, deletedRaw) });
	}
	return entries;
}

function parseNumstatEntries(
	stdout: string,
): Array<{ path: string; insertions: number; deletions: number }> {
	return stdout.includes("\0") ? parseNullTerminatedNumstatEntries(stdout) : parseTextNumstatEntries(stdout);
}

function parseFirstNumstatEntry(stdout: string): { insertions: number; deletions: number } | null {
	const [entry] = parseNumstatEntries(stdout);
	return entry ? { insertions: entry.insertions, deletions: entry.deletions } : null;
}

function getPorcelainToken(record: string, tokenIndex: number): string | null {
	let start = 0;
	for (let index = 0; index <= tokenIndex; index += 1) {
		const end = record.indexOf(" ", start);
		if (index === tokenIndex) {
			const token = end >= 0 ? record.slice(start, end) : record.slice(start);
			return token.length > 0 ? token : null;
		}
		if (end < 0) {
			return null;
		}
		start = end + 1;
	}
	return null;
}

function getPorcelainPathAfterTokenCount(record: string, tokenCount: number): string | null {
	let start = 0;
	for (let index = 0; index < tokenCount; index += 1) {
		const end = record.indexOf(" ", start);
		if (end < 0) {
			return null;
		}
		start = end + 1;
	}
	const pathValue = record.slice(start);
	return pathValue.length > 0 ? pathValue : null;
}

function parsePorcelainPathRecord(record: string): string | null {
	if (record.startsWith("? ") || record.startsWith("! ")) {
		const simple = record.slice(2);
		return simple.length > 0 ? simple : null;
	}
	if (record.startsWith("1 ")) {
		return getPorcelainPathAfterTokenCount(record, 8);
	}
	if (record.startsWith("2 ")) {
		return getPorcelainPathAfterTokenCount(record, 9);
	}
	if (record.startsWith("u ")) {
		return getPorcelainPathAfterTokenCount(record, 10);
	}
	return null;
}

function classifyPorcelainV2Xy(xyToken: string): GitWorkingTreeFileStatus {
	if (xyToken.length < 2) {
		return "modified";
	}
	const indexColumn = xyToken[0] ?? ".";
	const workTreeColumn = xyToken[1] ?? ".";
	const fromColumn = (column: string): GitWorkingTreeFileStatus | null => {
		if (column === ".") {
			return null;
		}
		if (column === "D") {
			return "deleted";
		}
		if (column === "A") {
			return "added";
		}
		if (column === "R" || column === "C") {
			return "renamed";
		}
		return "modified";
	};
	return fromColumn(workTreeColumn) ?? fromColumn(indexColumn) ?? "modified";
}

function parsePorcelainV2ChangeFlags(xyToken: string): WorkingTreeChangeFlags {
	if (xyToken.length < 2) {
		return { staged: false, unstaged: true };
	}
	return { staged: xyToken[0] !== ".", unstaged: xyToken[1] !== "." };
}

function mergeWorkingTreeFileStatus(
	previous: GitWorkingTreeFileStatus | undefined,
	incoming: GitWorkingTreeFileStatus,
): GitWorkingTreeFileStatus {
	const rank: Record<GitWorkingTreeFileStatus, number> = {
		conflict: 7,
		deleted: 6,
		untracked: 5,
		added: 4,
		renamed: 4,
		modified: 3,
		ignored: 2,
	};
	return !previous || rank[incoming] >= rank[previous] ? incoming : previous;
}

function pokeWorkingTreeStatus(
	map: Map<string, GitWorkingTreeFileStatus>,
	pathValue: string,
	incoming: GitWorkingTreeFileStatus,
): void {
	map.set(pathValue, mergeWorkingTreeFileStatus(map.get(pathValue), incoming));
}

function pokeWorkingTreeChangeFlags(
	map: Map<string, WorkingTreeChangeFlags>,
	pathValue: string,
	incoming: WorkingTreeChangeFlags,
): void {
	const current = map.get(pathValue) ?? { staged: false, unstaged: false };
	map.set(pathValue, {
		staged: current.staged || incoming.staged,
		unstaged: current.unstaged || incoming.unstaged,
	});
}

function resolveWorkingTreeChangeFlags(
	pathValue: string,
	stagedPaths: ReadonlySet<string>,
	unstagedPaths: ReadonlySet<string>,
	porcelainFlagsByPath: ReadonlyMap<string, WorkingTreeChangeFlags>,
): WorkingTreeChangeFlags {
	const porcelainFlags = porcelainFlagsByPath.get(pathValue);
	return {
		staged: stagedPaths.has(pathValue) || (porcelainFlags?.staged ?? false),
		unstaged: unstagedPaths.has(pathValue) || (porcelainFlags?.unstaged ?? false),
	};
}

function fileExtension(filePath: string): string {
	const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
	const extensionStart = fileName.lastIndexOf(".");
	if (extensionStart <= 0 || extensionStart === fileName.length - 1) {
		return "";
	}
	return fileName.slice(extensionStart + 1).toLowerCase();
}

function resolveGitNonTextFileType(filePath: string): GitNonTextFileType {
	const extension = fileExtension(filePath);
	if (IMAGE_FILE_EXTENSIONS.has(extension)) {
		return "image";
	}
	if (VIDEO_FILE_EXTENSIONS.has(extension)) {
		return "video";
	}
	if (AUDIO_FILE_EXTENSIONS.has(extension)) {
		return "audio";
	}
	if (ARCHIVE_FILE_EXTENSIONS.has(extension)) {
		return "archive";
	}
	if (DOCUMENT_FILE_EXTENSIONS.has(extension)) {
		return "document";
	}
	if (FONT_FILE_EXTENSIONS.has(extension)) {
		return "font";
	}
	return "binary";
}

function gitNonTextFileTypeLabel(fileType: GitNonTextFileType): string {
	switch (fileType) {
		case "image":
			return "Image";
		case "video":
			return "Video";
		case "audio":
			return "Audio";
		case "archive":
			return "Archive";
		case "document":
			return "Document";
		case "font":
			return "Font";
		case "binary":
			return "Binary";
	}
}

function isGitBinaryPatch(patch: string): boolean {
	return patch.includes("\nBinary files ") || patch.includes("\nGIT binary patch\n");
}

function isTruncatedGitOutput(output: string): boolean {
	return output.endsWith(OUTPUT_TRUNCATED_MARKER);
}

function gitNonTextPatchResult(filePath: string, patch: string): GitFilePatchResult | null {
	if (!isGitBinaryPatch(patch)) {
		return null;
	}
	const fileType = resolveGitNonTextFileType(filePath);
	return {
		kind: "non_text",
		fileType,
		message: `${gitNonTextFileTypeLabel(fileType)} changes are not rendered as text diffs.`,
	};
}

function gitLargePatchResult(): GitFilePatchResult {
	return { kind: "large", message: "Large diffs are hidden by default." };
}

function parseBranchLine(line: string): { name: string; current: boolean } | null {
	const trimmed = line.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const name = trimmed.replace(/^[*+]\s+/, "");
	if (name.includes(" -> ") || name.startsWith("(")) {
		return null;
	}
	return { name, current: trimmed.startsWith("* ") };
}

function parseRemoteNamesInGitOrder(stdout: string): ReadonlyArray<string> {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function parseRemoteNames(stdout: string): ReadonlyArray<string> {
	return parseRemoteNamesInGitOrder(stdout).toSorted((a, b) => b.length - a.length);
}

function parseRemoteRefWithRemoteNames(
	ref: string,
	remoteNames: ReadonlyArray<string>,
): { remoteRef: string; remoteName: string; branchName: string } | null {
	const trimmedRef = ref.trim();
	for (const remoteName of remoteNames) {
		const remotePrefix = `${remoteName}/`;
		if (!trimmedRef.startsWith(remotePrefix)) {
			continue;
		}
		const branchName = trimmedRef.slice(remotePrefix.length).trim();
		return branchName.length > 0 ? { remoteRef: trimmedRef, remoteName, branchName } : null;
	}
	return null;
}

function extractBranchNameFromRemoteRef(
	ref: string,
	options?: { readonly remoteName?: string | null; readonly remoteNames?: ReadonlyArray<string> },
): string {
	const normalized = ref.trim();
	if (normalized.length === 0) {
		return "";
	}
	if (normalized.startsWith("refs/remotes/")) {
		return extractBranchNameFromRemoteRef(normalized.slice("refs/remotes/".length), options);
	}
	const remoteNames = options?.remoteName ? [options.remoteName] : (options?.remoteNames ?? []);
	const parsedRemoteRef = parseRemoteRefWithRemoteNames(normalized, remoteNames);
	if (parsedRemoteRef) {
		return parsedRemoteRef.branchName;
	}
	const firstSlash = normalized.indexOf("/");
	return firstSlash === -1 ? normalized : normalized.slice(firstSlash + 1).trim();
}

function parseDefaultBranchFromRemoteHeadRef(value: string, remoteName: string): string | null {
	const trimmed = value.trim();
	const prefix = `refs/remotes/${remoteName}/`;
	return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() || null : null;
}

function parseUpstreamRefWithRemoteNames(
	upstreamRef: string,
	remoteNames: ReadonlyArray<string>,
): { upstreamRef: string; remoteName: string; upstreamBranch: string } | null {
	const parsed = parseRemoteRefWithRemoteNames(upstreamRef, remoteNames);
	return parsed
		? { upstreamRef, remoteName: parsed.remoteName, upstreamBranch: parsed.branchName }
		: null;
}

function parseUpstreamRefByFirstSeparator(
	upstreamRef: string,
): { upstreamRef: string; remoteName: string; upstreamBranch: string } | null {
	const separatorIndex = upstreamRef.indexOf("/");
	if (separatorIndex <= 0 || separatorIndex === upstreamRef.length - 1) {
		return null;
	}
	const remoteName = upstreamRef.slice(0, separatorIndex).trim();
	const upstreamBranch = upstreamRef.slice(separatorIndex + 1).trim();
	return remoteName && upstreamBranch ? { upstreamRef, remoteName, upstreamBranch } : null;
}

function parseTrackingBranchByUpstreamRef(stdout: string, upstreamRef: string): string | null {
	for (const line of stdout.split("\n")) {
		const trimmedLine = line.trim();
		if (trimmedLine.length === 0) {
			continue;
		}
		const [branchNameRaw, upstreamBranchRaw = ""] = trimmedLine.split("\t");
		const branchName = branchNameRaw?.trim() ?? "";
		const upstreamBranch = upstreamBranchRaw.trim();
		if (branchName.length > 0 && upstreamBranch === upstreamRef) {
			return branchName;
		}
	}
	return null;
}

function deriveLocalBranchNameFromRemoteRef(branchName: string): string | null {
	const separatorIndex = branchName.indexOf("/");
	if (separatorIndex <= 0 || separatorIndex === branchName.length - 1) {
		return null;
	}
	const localBranch = branchName.slice(separatorIndex + 1).trim();
	return localBranch.length > 0 ? localBranch : null;
}

function filterBranchesForListQuery(
	branches: ReadonlyArray<GitBranch>,
	query?: string,
): ReadonlyArray<GitBranch> {
	const normalizedQuery = query?.toLowerCase();
	return normalizedQuery
		? branches.filter((branch) => branch.name.toLowerCase().includes(normalizedQuery))
		: branches;
}

function paginateBranches(input: {
	readonly branches: ReadonlyArray<GitBranch>;
	readonly cursor?: number;
	readonly limit?: number;
}): { branches: ReadonlyArray<GitBranch>; nextCursor: number | null; totalCount: number } {
	const cursor = input.cursor ?? 0;
	const limit = input.limit ?? GIT_LIST_BRANCHES_DEFAULT_LIMIT;
	const totalCount = input.branches.length;
	const branches = input.branches.slice(cursor, cursor + limit);
	return {
		branches,
		nextCursor: cursor + branches.length < totalCount ? cursor + branches.length : null,
		totalCount,
	};
}

function sanitizeRemoteName(value: string): string {
	const sanitized = value
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return sanitized.length > 0 ? sanitized : "fork";
}

function normalizeRemoteUrl(value: string): string {
	return value
		.trim()
		.replace(/\/+$/g, "")
		.replace(/\.git$/i, "")
		.toLowerCase();
}

function parseRemoteFetchUrls(stdout: string): Map<string, string> {
	const remotes = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(trimmed);
		if (!match) {
			continue;
		}
		const remoteName = match[1] ?? "";
		const remoteUrl = match[2] ?? "";
		const direction = match[3] ?? "";
		if (direction === "fetch" && remoteName.length > 0 && remoteUrl.length > 0) {
			remotes.set(remoteName, remoteUrl);
		}
	}
	return remotes;
}

function normalizeCwd(cwd: string): string {
	try {
		return normalizePathSeparators(realpathSync.native(cwd));
	} catch {
		return cwd;
	}
}

function canonicalizeExistingPath(value: string): string {
	try {
		return realpathSync.native(value);
	} catch {
		return value;
	}
}

function fingerprintStatusPart(status: unknown): string {
	return JSON.stringify(status);
}

function shouldIgnoreGitWatchPath(filename: string | Buffer | null): boolean {
	if (filename === null) {
		return false;
	}
	const normalized = normalizePathSeparators(filename.toString());
	return normalized === ".git/index.lock" || normalized.endsWith("/.git/index.lock");
}

function remoteRefreshFailureDelay(consecutiveFailures: number): number {
	const exponent = Math.max(0, consecutiveFailures - 1);
	const backoffMs = GIT_STATUS_REFRESH_FAILURE_BASE_DELAY_MS * Math.pow(2, exponent);
	return Math.max(GIT_STATUS_REFRESH_INTERVAL_MS, Math.min(backoffMs, GIT_STATUS_REFRESH_FAILURE_MAX_DELAY_MS));
}

function truncateText(value: string | undefined, maxLength = TOAST_DESCRIPTION_MAX): string | undefined {
	if (!value) {
		return undefined;
	}
	if (value.length <= maxLength) {
		return value;
	}
	if (maxLength <= 3) {
		return "...".slice(0, maxLength);
	}
	return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function shortenSha(sha: string | undefined): string | null {
	return sha ? sha.slice(0, SHORT_SHA_LENGTH) : null;
}

function sanitizeProgressText(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}
	return trimmed.length <= MAX_PROGRESS_TEXT_LENGTH ? trimmed : trimmed.slice(0, MAX_PROGRESS_TEXT_LENGTH).trimEnd();
}

function parseCustomCommitMessage(raw: string): { subject: string; body: string } | null {
	const normalized = raw.replace(/\r\n/g, "\n").trim();
	if (normalized.length === 0) {
		return null;
	}
	const [firstLine, ...rest] = normalized.split("\n");
	const subject = firstLine?.trim() ?? "";
	return subject.length > 0 ? { subject, body: rest.join("\n").trim() } : null;
}

function formatCommitMessage(subject: string, body: string): string {
	const trimmedBody = body.trim();
	return trimmedBody.length === 0 ? subject : `${subject}\n\n${trimmedBody}`;
}

function isCommitAction(
	action: GitStackedAction,
): action is "commit" | "commit_push" | "commit_push_pr" {
	return action === "commit" || action === "commit_push" || action === "commit_push_pr";
}

function normalizePullRequestReference(reference: string): string {
	const trimmed = reference.trim();
	const hashNumber = /^#(\d+)$/.exec(trimmed);
	return hashNumber?.[1] ?? trimmed;
}

function parseRepositoryNameFromPullRequestUrl(url: string): string | null {
	const trimmed = url.trim();
	const match = /^https:\/\/github\.com\/[^/]+\/([^/]+)\/pull\/\d+(?:\/.*)?$/i.exec(trimmed);
	const repositoryName = match?.[1]?.trim() ?? "";
	return repositoryName.length > 0 ? repositoryName : null;
}

function parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url: string | null): string | null {
	const trimmed = url?.trim() ?? "";
	if (trimmed.length === 0) {
		return null;
	}
	const match =
		/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(
			trimmed,
		);
	const repositoryNameWithOwner = match?.[1]?.trim() ?? "";
	return repositoryNameWithOwner.length > 0 ? repositoryNameWithOwner : null;
}

function parseRepositoryOwnerLogin(nameWithOwner: string | null): string | null {
	const trimmed = nameWithOwner?.trim() ?? "";
	if (trimmed.length === 0) {
		return null;
	}
	const [ownerLogin] = trimmed.split("/");
	const normalizedOwnerLogin = ownerLogin?.trim() ?? "";
	return normalizedOwnerLogin.length > 0 ? normalizedOwnerLogin : null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
	const trimmed = value?.trim() ?? "";
	return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalRepositoryNameWithOwner(value: string | null | undefined): string | null {
	const normalized = normalizeOptionalString(value);
	return normalized ? normalized.toLowerCase() : null;
}

function normalizeOptionalOwnerLogin(value: string | null | undefined): string | null {
	const normalized = normalizeOptionalString(value);
	return normalized ? normalized.toLowerCase() : null;
}

function resolvePullRequestHeadRepositoryNameWithOwner(
	pr: PullRequestHeadRemoteInfo & { readonly url: string },
): string | null {
	const explicitRepository = normalizeOptionalString(pr.headRepositoryNameWithOwner);
	if (explicitRepository) {
		return explicitRepository;
	}
	if (!pr.isCrossRepository) {
		return null;
	}
	const ownerLogin = normalizeOptionalString(pr.headRepositoryOwnerLogin);
	const repositoryName = parseRepositoryNameFromPullRequestUrl(pr.url);
	return ownerLogin && repositoryName ? `${ownerLogin}/${repositoryName}` : null;
}

function matchesBranchHeadContext(
	pr: PullRequestInfo,
	headContext: Pick<
		BranchHeadContext,
		"headBranch" | "headRepositoryNameWithOwner" | "headRepositoryOwnerLogin" | "isCrossRepository"
	>,
): boolean {
	if (pr.headRefName !== headContext.headBranch) {
		return false;
	}
	const expectedHeadRepository = normalizeOptionalRepositoryNameWithOwner(
		headContext.headRepositoryNameWithOwner,
	);
	const expectedHeadOwner =
		normalizeOptionalOwnerLogin(headContext.headRepositoryOwnerLogin) ??
		parseRepositoryOwnerLogin(expectedHeadRepository);
	const prHeadRepository = normalizeOptionalRepositoryNameWithOwner(
		resolvePullRequestHeadRepositoryNameWithOwner(pr),
	);
	const prHeadOwner =
		normalizeOptionalOwnerLogin(pr.headRepositoryOwnerLogin) ??
		parseRepositoryOwnerLogin(prHeadRepository);
	if (headContext.isCrossRepository) {
		if (pr.isCrossRepository === false) {
			return false;
		}
		if ((expectedHeadRepository || expectedHeadOwner) && !prHeadRepository && !prHeadOwner) {
			return false;
		}
		if (expectedHeadRepository && prHeadRepository && expectedHeadRepository !== prHeadRepository) {
			return false;
		}
		if (expectedHeadOwner && prHeadOwner && expectedHeadOwner !== prHeadOwner) {
			return false;
		}
		return true;
	}
	if (pr.isCrossRepository === true) {
		return false;
	}
	if (expectedHeadRepository && prHeadRepository && expectedHeadRepository !== prHeadRepository) {
		return false;
	}
	if (expectedHeadOwner && prHeadOwner && expectedHeadOwner !== prHeadOwner) {
		return false;
	}
	return true;
}

function resolveHeadRepositoryNameWithOwner(
	pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
): string | null {
	const explicitRepository = pullRequest.headRepositoryNameWithOwner?.trim() ?? "";
	if (explicitRepository.length > 0) {
		return explicitRepository;
	}
	if (!pullRequest.isCrossRepository) {
		return null;
	}
	const ownerLogin = pullRequest.headRepositoryOwnerLogin?.trim() ?? "";
	const repositoryName = parseRepositoryNameFromPullRequestUrl(pullRequest.url);
	return ownerLogin.length > 0 && repositoryName ? `${ownerLogin}/${repositoryName}` : null;
}

function resolvePullRequestWorktreeLocalBranchName(
	pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
): string {
	if (!pullRequest.isCrossRepository) {
		return pullRequest.headBranch;
	}
	const sanitizedHeadBranch = sanitizeBranchFragment(pullRequest.headBranch).trim();
	const suffix = sanitizedHeadBranch.length > 0 ? sanitizedHeadBranch : "head";
	return `honk/pr-${pullRequest.number}/${suffix}`;
}

function shouldPreferSshRemote(url: string | null): boolean {
	const trimmed = url?.trim() ?? "";
	return trimmed.startsWith("git@") || trimmed.startsWith("ssh://");
}

function toPullRequestHeadRemoteInfo(pr: GitHubPullRequestSummary): PullRequestHeadRemoteInfo {
	return {
		...(pr.isCrossRepository !== undefined ? { isCrossRepository: pr.isCrossRepository } : {}),
		...(pr.headRepositoryNameWithOwner !== undefined
			? { headRepositoryNameWithOwner: pr.headRepositoryNameWithOwner }
			: {}),
		...(pr.headRepositoryOwnerLogin !== undefined
			? { headRepositoryOwnerLogin: pr.headRepositoryOwnerLogin }
			: {}),
	};
}

function toResolvedPullRequest(pr: GitHubPullRequestSummary): ResolvedPullRequest {
	return {
		number: pr.number,
		title: pr.title,
		url: pr.url,
		baseBranch: pr.baseRefName,
		headBranch: pr.headRefName,
		state: pr.state ?? "open",
	};
}

function toStatusPr(pr: PullRequestInfo): GitStatusRemoteResult["pr"] {
	return {
		number: pr.number,
		title: pr.title,
		url: pr.url,
		baseBranch: pr.baseRefName,
		headBranch: pr.headRefName,
		state: pr.state,
	};
}

const RawGitHubPullRequestSchema = Schema.Struct({
	number: PositiveInt,
	title: TrimmedNonEmptyString,
	url: TrimmedNonEmptyString,
	baseRefName: TrimmedNonEmptyString,
	headRefName: TrimmedNonEmptyString,
	state: Schema.optional(Schema.Unknown),
	mergedAt: Schema.optional(Schema.Unknown),
	updatedAt: Schema.optional(Schema.Unknown),
	isCrossRepository: Schema.optional(Schema.Unknown),
	headRepository: Schema.optional(Schema.Unknown),
	headRepositoryOwner: Schema.optional(Schema.Unknown),
});

const GitHubRepositoryCloneUrlsSchema = Schema.Struct({
	nameWithOwner: TrimmedNonEmptyString,
	url: TrimmedNonEmptyString,
	sshUrl: TrimmedNonEmptyString,
});

const decodeRawGitHubPullRequest = Schema.decodeUnknownOption(RawGitHubPullRequestSchema);
const decodeGitHubRepositoryCloneUrls = Schema.decodeUnknownOption(GitHubRepositoryCloneUrlsSchema);
const decodeGitHubJsonRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const decodeGitHubOptionalString = Schema.decodeUnknownOption(Schema.String);
const decodeGitHubOptionalBoolean = Schema.decodeUnknownOption(Schema.Boolean);
const decodeGitHubHeadRepository = Schema.decodeUnknownOption(
	Schema.Struct({ nameWithOwner: TrimmedNonEmptyString }),
);
const decodeGitHubHeadRepositoryOwner = Schema.decodeUnknownOption(
	Schema.Struct({ login: TrimmedNonEmptyString }),
);

function normalizeGitHubPullRequestState(input: {
	readonly state?: string | null;
	readonly mergedAt?: string | null;
}): "open" | "closed" | "merged" {
	const normalizedState = input.state?.trim().toUpperCase();
	if ((input.mergedAt && input.mergedAt.trim().length > 0) || normalizedState === "MERGED") {
		return "merged";
	}
	return normalizedState === "CLOSED" ? "closed" : "open";
}

function normalizeGitHubPullRequestRecord(value: unknown): PullRequestInfo | null {
	const decoded = decodeRawGitHubPullRequest(value);
	if (Option.isNone(decoded)) {
		return null;
	}
	const record = decoded.value;
	const headRepository = Option.getOrNull(decodeGitHubHeadRepository(record.headRepository));
	const headRepositoryOwner = Option.getOrNull(
		decodeGitHubHeadRepositoryOwner(record.headRepositoryOwner),
	);
	const headRepositoryNameWithOwner = headRepository?.nameWithOwner ?? null;
	const ownerFromRepository = headRepositoryNameWithOwner?.includes("/")
		? (headRepositoryNameWithOwner.split("/")[0] ?? null)
		: null;
	const headRepositoryOwnerLogin = headRepositoryOwner?.login ?? ownerFromRepository;
	const updatedAtRaw = Option.getOrNull(decodeGitHubOptionalString(record.updatedAt));
	const isCrossRepository = decodeGitHubOptionalBoolean(record.isCrossRepository);
	return {
		number: record.number,
		title: record.title,
		url: record.url,
		baseRefName: record.baseRefName,
		headRefName: record.headRefName,
		state: normalizeGitHubPullRequestState({
			state: Option.getOrNull(decodeGitHubOptionalString(record.state)),
			mergedAt: Option.getOrNull(decodeGitHubOptionalString(record.mergedAt)),
		}),
		updatedAt: updatedAtRaw !== null && updatedAtRaw.trim() ? updatedAtRaw : null,
		...(Option.isSome(isCrossRepository) ? { isCrossRepository: isCrossRepository.value } : {}),
		...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
		...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
	};
}

function parseGitHubPullRequestListJson(raw: string): ReadonlyArray<PullRequestInfo> {
	const parsed: unknown = JSON.parse(raw);
	if (!Array.isArray(parsed)) {
		return [];
	}
	return parsed.flatMap((entry) => {
		const normalized = normalizeGitHubPullRequestRecord(entry);
		return normalized ? [normalized] : [];
	});
}

function parseGitHubPullRequestJson(raw: string): GitHubPullRequestSummary {
	const normalized = normalizeGitHubPullRequestRecord(JSON.parse(raw));
	if (!normalized) {
		throw new Error("GitHub CLI returned invalid pull request JSON.");
	}
	return {
		number: normalized.number,
		title: normalized.title,
		url: normalized.url,
		baseRefName: normalized.baseRefName,
		headRefName: normalized.headRefName,
		state: normalized.state,
		...(normalized.isCrossRepository !== undefined
			? { isCrossRepository: normalized.isCrossRepository }
			: {}),
		...(normalized.headRepositoryNameWithOwner !== undefined
			? { headRepositoryNameWithOwner: normalized.headRepositoryNameWithOwner }
			: {}),
		...(normalized.headRepositoryOwnerLogin !== undefined
			? { headRepositoryOwnerLogin: normalized.headRepositoryOwnerLogin }
			: {}),
	};
}

function parseGitHubRepositoryCloneUrls(raw: string): GitHubRepositoryCloneUrls {
	const parsed: unknown = JSON.parse(raw);
	const decoded = decodeGitHubRepositoryCloneUrls(parsed);
	if (Option.isSome(decoded)) {
		return decoded.value;
	}
	if (Option.isNone(decodeGitHubJsonRecord(parsed))) {
		throw new Error("GitHub CLI returned invalid repository JSON.");
	}
	throw new Error("GitHub CLI returned incomplete repository JSON.");
}

async function statFile(filePath: string): Promise<{ readonly isFile: boolean; readonly size: number } | null> {
	try {
		const stat = await fs.stat(filePath);
		return { isFile: stat.isFile(), size: stat.size };
	} catch {
		return null;
	}
}

function appendUnique(values: string[], next: string | null | undefined): void {
	const trimmed = next?.trim() ?? "";
	if (trimmed.length > 0 && !values.includes(trimmed)) {
		values.push(trimmed);
	}
}

function summarizeGitActionResult(
	result: Pick<GitRunStackedActionResult, "commit" | "push" | "pr">,
): { title: string; description?: string } {
	if (result.pr.status === "created" || result.pr.status === "opened_existing") {
		const prNumber = result.pr.number ? ` #${result.pr.number}` : "";
		const description = truncateText(result.pr.title);
		const title = `${result.pr.status === "created" ? "Created PR" : "Opened PR"}${prNumber}`;
		return description ? { title, description } : { title };
	}
	if (result.push.status === "pushed") {
		const shortSha = shortenSha(result.commit.commitSha);
		const branch = result.push.upstreamBranch ?? result.push.branch;
		const pushedCommitPart = shortSha ? ` ${shortSha}` : "";
		const branchPart = branch ? ` to ${branch}` : "";
		const description = truncateText(result.commit.subject);
		const title = `Pushed${pushedCommitPart}${branchPart}`;
		return description ? { title, description } : { title };
	}
	if (result.commit.status === "created") {
		const shortSha = shortenSha(result.commit.commitSha);
		const description = truncateText(result.commit.subject);
		const title = shortSha ? `Committed ${shortSha}` : "Committed changes";
		return description ? { title, description } : { title };
	}
	return { title: "Done" };
}

export class DesktopAuxGitService {
	private readonly tmpDir: string;
	private readonly worktreesDir: string;
	private readonly statusCache = new Map<string, CachedGitStatus>();
	private readonly localStatusCache = new Map<string, CachedValue<GitStatusLocalResult>>();
	private readonly remoteStatusCache = new Map<string, CachedValue<GitStatusRemoteResult | null>>();
	private readonly latestPrCache = new Map<string, CachedValue<PullRequestInfo | null>>();
	private readonly upstreamRefreshCache = new Map<string, number>();
	private readonly statusListeners = new Map<string, Set<GitStatusListener>>();
	private readonly localWatchers = new Map<string, ActiveLocalWatcher>();
	private readonly remotePollers = new Map<string, ActiveRemotePoller>();
	private disposed = false;

	constructor(options: DesktopAuxGitOptions) {
		this.worktreesDir = options.worktreesDir;
		this.tmpDir = options.tmpDir ?? os.tmpdir();
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		for (const watcher of this.localWatchers.values()) {
			this.closeLocalWatcher(watcher);
		}
		for (const poller of this.remotePollers.values()) {
			poller.stopped = true;
			if (poller.timer) {
				clearTimeout(poller.timer);
			}
		}
		this.localWatchers.clear();
		this.remotePollers.clear();
		this.statusListeners.clear();
	}

	async execute(input: ExecuteGitInput): Promise<ExecuteGitResult> {
		const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
		const truncateOutputAtMaxBytes = input.truncateOutputAtMaxBytes ?? false;
		return runProcess("git", input.args, {
			operation: input.operation,
			cwd: input.cwd,
			timeoutMs,
			maxOutputBytes,
			truncateOutputAtMaxBytes,
			...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
			...(input.env !== undefined ? { env: input.env } : {}),
			...(input.allowNonZeroExit !== undefined
				? { allowNonZeroExit: input.allowNonZeroExit }
				: {}),
			...(input.progress !== undefined ? { progress: input.progress } : {}),
		});
	}

	async refreshStatus(input: GitStatusInput): Promise<GitStatusResult> {
		const normalizedCwd = normalizeCwd(input.cwd);
		const local = await this.refreshLocalStatus(normalizedCwd);
		const cached = this.statusCache.get(normalizedCwd);
		const remote =
			local.isRepo && local.hasOriginRemote
				? input.scope === "local"
					? (cached?.remote?.value ?? null)
					: await this.refreshRemoteStatus(normalizedCwd)
				: null;
		return mergeGitStatusParts(local, remote);
	}

	async subscribeStatus(input: GitStatusInput, listener: GitStatusListener): Promise<() => void> {
		const normalizedCwd = normalizeCwd(input.cwd);
		const listeners = this.statusListeners.get(normalizedCwd) ?? new Set<GitStatusListener>();
		listeners.add(listener);
		this.statusListeners.set(normalizedCwd, listeners);

		const initialLocal = await this.getOrLoadLocalStatus(normalizedCwd);
		const initialRemote = this.statusCache.get(normalizedCwd)?.remote?.value ?? null;
		listener({ _tag: "snapshot", local: initialLocal, remote: initialRemote });

		this.retainLocalWatcher(normalizedCwd);
		const shouldPollRemote = initialLocal.isRepo && initialLocal.hasOriginRemote;
		if (shouldPollRemote) {
			this.retainRemotePoller(normalizedCwd);
		}

		let released = false;
		return () => {
			if (released) {
				return;
			}
			released = true;
			listeners.delete(listener);
			if (listeners.size === 0) {
				this.statusListeners.delete(normalizedCwd);
			}
			this.releaseLocalWatcher(normalizedCwd);
			if (shouldPollRemote) {
				this.releaseRemotePoller(normalizedCwd);
			}
		};
	}

	async status(input: GitStatusInput): Promise<GitStatusResult> {
		const [local, remote] = await Promise.all([this.localStatus(input), this.remoteStatus(input)]);
		return mergeGitStatusParts(local, remote);
	}

	async localStatus(input: GitStatusInput): Promise<GitStatusLocalResult> {
		const key = normalizeCwd(input.cwd);
		const cached = this.localStatusCache.get(key);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.value;
		}
		const local = await this.readLocalStatus(key);
		this.localStatusCache.set(key, {
			value: local,
			fingerprint: fingerprintStatusPart(local),
			expiresAt: Date.now() + STATUS_RESULT_CACHE_TTL_MS,
		});
		return local;
	}

	async remoteStatus(input: GitStatusInput): Promise<GitStatusRemoteResult | null> {
		const key = normalizeCwd(input.cwd);
		const cached = this.remoteStatusCache.get(key);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.value;
		}
		const remote = await this.readRemoteStatus(key);
		this.remoteStatusCache.set(key, {
			value: remote,
			fingerprint: fingerprintStatusPart(remote),
			expiresAt: Date.now() + STATUS_RESULT_CACHE_TTL_MS,
		});
		return remote;
	}

	invalidateLocalStatus(cwd: string): void {
		const key = normalizeCwd(cwd);
		this.localStatusCache.delete(key);
		const cached = this.statusCache.get(key);
		if (cached) {
			this.statusCache.set(key, { ...cached, local: null });
		}
	}

	invalidateRemoteStatus(cwd: string): void {
		const key = normalizeCwd(cwd);
		this.remoteStatusCache.delete(key);
		const cached = this.statusCache.get(key);
		if (cached) {
			this.statusCache.set(key, { ...cached, remote: null });
		}
	}

	invalidateStatus(cwd: string): void {
		this.invalidateLocalStatus(cwd);
		this.invalidateRemoteStatus(cwd);
	}

	async pull(input: GitPullInput): Promise<GitPullResult> {
		return this.pullCurrentBranch(input.cwd);
	}

	async discardPaths(input: GitDiscardPathsInput): Promise<void> {
		await this.executeGit("GitCore.discardPaths.reset", input.cwd, [
			...PROJECT_GIT_HARDENED_LITERAL_PATHSPECS_ARGS,
			"reset",
			"--",
			...input.paths,
		], { allowNonZeroExit: true });
		await this.executeGit("GitCore.discardPaths.checkout", input.cwd, [
			...PROJECT_GIT_HARDENED_LITERAL_PATHSPECS_ARGS,
			"checkout",
			"--",
			...input.paths,
		], { allowNonZeroExit: true });
		await this.executeGit("GitCore.discardPaths.clean", input.cwd, [
			...PROJECT_GIT_HARDENED_LITERAL_PATHSPECS_ARGS,
			"clean",
			"-fd",
			"--",
			...input.paths,
		]);
		this.invalidateStatus(input.cwd);
	}

	async getFilePatch(input: GitFilePatchInput): Promise<GitFilePatchResult> {
		const pathspec = input.prevPath ? [input.prevPath, input.path] : [input.path];
		const unifiedDiff = await this.gitStdoutWithOptions(
			"GitCore.getFilePatch",
			input.cwd,
			[
				...PROJECT_GIT_HARDENED_LITERAL_PATHSPECS_ARGS,
				"diff",
				"--patch",
				"--minimal",
				"--find-renames=1%",
				"HEAD",
				"--",
				...pathspec,
			],
			{
				maxOutputBytes: PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES,
				truncateOutputAtMaxBytes: true,
			},
		);
		if (unifiedDiff.trim().length > 0) {
			if (isTruncatedGitOutput(unifiedDiff)) {
				return gitLargePatchResult();
			}
			const nonTextPatch = gitNonTextPatchResult(input.path, unifiedDiff);
			return nonTextPatch ?? { kind: "patch", patch: unifiedDiff };
		}

		const untrackedPaths = await this.gitStdoutWithOptions(
			"GitCore.getFilePatch.untrackedPaths",
			input.cwd,
			[
				...PROJECT_GIT_HARDENED_LITERAL_PATHSPECS_ARGS,
				"ls-files",
				"--others",
				"--exclude-standard",
				"-z",
				"--",
				input.path,
			],
		);
		if (splitNullSeparatedPaths(untrackedPaths, false).length === 0) {
			return input.prevPath
				? { kind: "rename_only", message: "Git reported a rename without a content patch." }
				: {
						kind: "empty",
						message: "Git reported this file in status, but did not return a patch for it.",
					};
		}

		const untrackedDiff = await this.gitStdoutWithOptions(
			"GitCore.getFilePatch.untracked",
			input.cwd,
			[
				...PROJECT_GIT_HARDENED_LITERAL_PATHSPECS_ARGS,
				"diff",
				"--no-index",
				"--patch",
				"--minimal",
				"--",
				"/dev/null",
				input.path,
			],
			{
				allowNonZeroExit: true,
				maxOutputBytes: PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES,
				truncateOutputAtMaxBytes: true,
			},
		);
		if (untrackedDiff.trim().length === 0) {
			return {
				kind: "empty",
				message: "Git reported this file as untracked, but did not return a patch for it.",
			};
		}
		if (isTruncatedGitOutput(untrackedDiff)) {
			return gitLargePatchResult();
		}
		const nonTextPatch = gitNonTextPatchResult(input.path, untrackedDiff);
		return nonTextPatch ?? { kind: "untracked", patch: untrackedDiff };
	}

	async getFileImage(input: GitFileImageInput): Promise<GitFileImageResult> {
		const mediaType = IMAGE_MEDIA_TYPES_BY_EXTENSION[fileExtension(input.path)];
		if (!mediaType) {
			return { kind: "unsupported" };
		}
		const repoRoot = path.resolve(input.cwd);
		const absolutePath = path.resolve(repoRoot, input.path);
		const relative = path.relative(repoRoot, absolutePath);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			throw gitCommandError("GitCore.getFileImage", input.cwd, [], "Image path must stay within the repository root.");
		}
		const fileInfo = await statFile(absolutePath);
		if (!fileInfo?.isFile) {
			return { kind: "missing" };
		}
		if (fileInfo.size > GIT_FILE_IMAGE_MAX_BYTES) {
			return { kind: "too_large", sizeBytes: fileInfo.size };
		}
		const bytes = await fs.readFile(absolutePath).catch((error: unknown) => {
			throw gitCommandError(
				"GitCore.getFileImage",
				input.cwd,
				[],
				`Failed to read image file: ${error instanceof Error ? error.message : String(error)}`,
				error,
			);
		});
		return {
			kind: "image",
			mediaType,
			dataBase64: bytes.toString("base64"),
			sizeBytes: bytes.byteLength,
		};
	}

	async listBranches(input: GitListBranchesInput): Promise<GitListBranchesResult> {
		const localBranchResult = await this.executeGit(
			"GitCore.listBranches.branchNoColor",
			input.cwd,
			["branch", "--no-color", "--no-column"],
			{ timeoutMs: 10_000, allowNonZeroExit: true },
		).catch((error: unknown) => {
			if (error instanceof GitCommandError && isMissingGitCwdError(error)) {
				return {
					code: 128,
					stdout: "",
					stderr: "fatal: not a git repository",
					stdoutTruncated: false,
					stderrTruncated: false,
				};
			}
			throw error;
		});

		if (localBranchResult.code !== 0) {
			const stderr = localBranchResult.stderr.trim();
			if (stderr.toLowerCase().includes("not a git repository")) {
				return { branches: [], isRepo: false, hasOriginRemote: false, nextCursor: null, totalCount: 0 };
			}
			throw gitCommandError("GitCore.listBranches", input.cwd, ["branch", "--no-color", "--no-column"], stderr || "git branch failed");
		}

		const [defaultRef, worktreeList, remoteBranchResult, remoteNamesResult, branchLastCommit] =
			await Promise.all([
				this.executeGit("GitCore.listBranches.defaultRef", input.cwd, [
					"symbolic-ref",
					"refs/remotes/origin/HEAD",
				], { timeoutMs: 5_000, allowNonZeroExit: true }),
				this.executeGit("GitCore.listBranches.worktreeList", input.cwd, [
					"worktree",
					"list",
					"--porcelain",
				], { timeoutMs: 5_000, allowNonZeroExit: true }),
				this.executeGit("GitCore.listBranches.remoteBranches", input.cwd, [
					"branch",
					"--no-color",
					"--no-column",
					"--remotes",
				], { timeoutMs: 10_000, allowNonZeroExit: true }).catch(() => ({
					code: 1,
					stdout: "",
					stderr: "",
					stdoutTruncated: false,
					stderrTruncated: false,
				})),
				this.executeGit("GitCore.listBranches.remoteNames", input.cwd, ["remote"], {
					timeoutMs: 5_000,
					allowNonZeroExit: true,
				}).catch(() => ({
					code: 1,
					stdout: "",
					stderr: "",
					stdoutTruncated: false,
					stderrTruncated: false,
				})),
				this.readBranchRecency(input.cwd).catch(() => new Map<string, number>()),
			]);

		const remoteNames = remoteNamesResult.code === 0 ? parseRemoteNames(remoteNamesResult.stdout) : [];
		const defaultBranch =
			defaultRef.code === 0 ? defaultRef.stdout.trim().replace(/^refs\/remotes\/origin\//, "") : null;
		const worktreeMap = await this.readWorktreeMap(worktreeList.stdout, worktreeList.code === 0);
		const localBranches = localBranchResult.stdout
			.split("\n")
			.map(parseBranchLine)
			.filter((branch): branch is { name: string; current: boolean } => branch !== null)
			.map((branch): GitBranch => ({
				name: branch.name,
				current: branch.current,
				isRemote: false,
				isDefault: branch.name === defaultBranch,
				worktreePath: worktreeMap.get(branch.name) ?? null,
			}))
			.toSorted((a, b) => {
				const aPriority = a.current ? 0 : a.isDefault ? 1 : 2;
				const bPriority = b.current ? 0 : b.isDefault ? 1 : 2;
				if (aPriority !== bPriority) {
					return aPriority - bPriority;
				}
				const aLastCommit = branchLastCommit.get(a.name) ?? 0;
				const bLastCommit = branchLastCommit.get(b.name) ?? 0;
				return aLastCommit !== bLastCommit ? bLastCommit - aLastCommit : a.name.localeCompare(b.name);
			});

		const remoteBranches =
			remoteBranchResult.code === 0
				? remoteBranchResult.stdout
						.split("\n")
						.map(parseBranchLine)
						.filter((branch): branch is { name: string; current: boolean } => branch !== null)
						.map((branch): GitBranch => {
							const parsedRemoteRef = parseRemoteRefWithRemoteNames(branch.name, remoteNames);
							return {
								name: branch.name,
								current: false,
								isRemote: true,
								...(parsedRemoteRef ? { remoteName: parsedRemoteRef.remoteName } : {}),
								isDefault: false,
								worktreePath: null,
							};
						})
						.toSorted((a, b) => {
							const aLastCommit = branchLastCommit.get(a.name) ?? 0;
							const bLastCommit = branchLastCommit.get(b.name) ?? 0;
							return aLastCommit !== bLastCommit
								? bLastCommit - aLastCommit
								: a.name.localeCompare(b.name);
						})
				: [];

		const page = paginateBranches({
			branches: filterBranchesForListQuery(
				dedupeRemoteBranchesWithLocalMatches([...localBranches, ...remoteBranches]),
				input.query,
			),
			...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
			...(input.limit !== undefined ? { limit: input.limit } : {}),
		});
		return {
			branches: [...page.branches],
			isRepo: true,
			hasOriginRemote: remoteNames.includes("origin"),
			nextCursor: page.nextCursor,
			totalCount: page.totalCount,
		};
	}

	async createWorktree(input: GitCreateWorktreeInput): Promise<GitCreateWorktreeResult> {
		const targetBranch = input.newBranch ?? input.branch;
		const sanitizedBranch = targetBranch.replace(/\//g, "-");
		const repoName = path.basename(input.cwd);
		// Null path derives under worktreesDir/repo/branch so callers can omit local layout details.
		const worktreePath = input.path ?? path.join(this.worktreesDir, repoName, sanitizedBranch);
		const args = input.newBranch
			? ["worktree", "add", "-b", input.newBranch, worktreePath, input.branch]
			: ["worktree", "add", worktreePath, input.branch];
		await this.executeGit("GitCore.createWorktree", input.cwd, args, {
			fallbackErrorMessage: "git worktree add failed",
		});
		this.invalidateStatus(input.cwd);
		return { worktree: { path: worktreePath, branch: targetBranch } };
	}

	async removeWorktree(input: GitRemoveWorktreeInput): Promise<void> {
		const args = ["worktree", "remove", ...(input.force ? ["--force"] : []), input.path];
		await this.executeGit("GitCore.removeWorktree", input.cwd, args, {
			timeoutMs: 15_000,
			fallbackErrorMessage: "git worktree remove failed",
		}).catch((error: unknown) => {
			throw gitCommandError(
				"GitCore.removeWorktree",
				input.cwd,
				args,
				`${gitCommandLabel(args)} failed (cwd: ${input.cwd}): ${error instanceof Error ? error.message : String(error)}`,
				error,
			);
		});
		this.invalidateStatus(input.cwd);
		this.invalidateStatus(input.path);
	}

	async createBranch(input: GitCreateBranchInput): Promise<GitCreateBranchResult> {
		await this.executeGit("GitCore.createBranch", input.cwd, ["branch", input.branch], {
			timeoutMs: 10_000,
			fallbackErrorMessage: "git branch create failed",
		});
		if (input.checkout) {
			await this.checkout(input);
		}
		this.invalidateStatus(input.cwd);
		return { branch: input.branch };
	}

	async checkout(input: GitCheckoutInput): Promise<GitCheckoutResult> {
		const [localInputExists, remoteExists] = await Promise.all([
			this.executeGit("GitCore.checkoutBranch.localInputExists", input.cwd, [
				"show-ref",
				"--verify",
				"--quiet",
				`refs/heads/${input.branch}`,
			], { timeoutMs: 5_000, allowNonZeroExit: true }).then((result) => result.code === 0),
			this.executeGit("GitCore.checkoutBranch.remoteExists", input.cwd, [
				"show-ref",
				"--verify",
				"--quiet",
				`refs/remotes/${input.branch}`,
			], { timeoutMs: 5_000, allowNonZeroExit: true }).then((result) => result.code === 0),
		]);
		const localTrackingBranch = remoteExists
			? await this.executeGit("GitCore.checkoutBranch.localTrackingBranch", input.cwd, [
					"for-each-ref",
					"--format=%(refname:short)\t%(upstream:short)",
					"refs/heads",
				], { timeoutMs: 5_000, allowNonZeroExit: true }).then((result) =>
					result.code === 0 ? parseTrackingBranchByUpstreamRef(result.stdout, input.branch) : null,
				)
			: null;
		const localTrackedBranchCandidate = deriveLocalBranchNameFromRemoteRef(input.branch);
		const localTrackedBranchTargetExists =
			remoteExists && localTrackedBranchCandidate
				? await this.executeGit("GitCore.checkoutBranch.localTrackedBranchTargetExists", input.cwd, [
						"show-ref",
						"--verify",
						"--quiet",
						`refs/heads/${localTrackedBranchCandidate}`,
					], { timeoutMs: 5_000, allowNonZeroExit: true }).then((result) => result.code === 0)
				: false;
		const checkoutArgs = localInputExists
			? ["checkout", input.branch]
			: remoteExists && !localTrackingBranch && localTrackedBranchTargetExists
				? ["checkout", input.branch]
				: remoteExists && !localTrackingBranch
					? ["checkout", "--track", input.branch]
					: remoteExists && localTrackingBranch
						? ["checkout", localTrackingBranch]
						: ["checkout", input.branch];
		await this.executeGit("GitCore.checkoutBranch.checkout", input.cwd, checkoutArgs, {
			timeoutMs: 10_000,
			fallbackErrorMessage: "git checkout failed",
		});
		const branch = await this.gitStdout("GitCore.checkoutBranch.currentBranch", input.cwd, [
			"branch",
			"--show-current",
		]).then((stdout) => stdout.trim() || null);
		this.invalidateStatus(input.cwd);
		return { branch };
	}

	async init(input: { readonly cwd: string }): Promise<void> {
		await this.executeGit("GitCore.initRepo", input.cwd, ["init"], {
			timeoutMs: 10_000,
			fallbackErrorMessage: "git init failed",
		});
		this.invalidateStatus(input.cwd);
	}

	async resolvePullRequest(input: GitPullRequestRefInput): Promise<GitResolvePullRequestResult> {
		const pullRequest = toResolvedPullRequest(
			await this.getPullRequest(input.cwd, normalizePullRequestReference(input.reference)),
		);
		return { pullRequest };
	}

	async preparePullRequestThread(
		input: GitPreparePullRequestThreadInput,
	): Promise<GitPreparePullRequestThreadResult> {
		try {
			const normalizedReference = normalizePullRequestReference(input.reference);
			const rootWorktreePath = canonicalizeExistingPath(input.cwd);
			const pullRequestSummary = await this.getPullRequest(input.cwd, normalizedReference);
			const pullRequest = toResolvedPullRequest(pullRequestSummary);
			const pullRequestWithRemoteInfo = {
				...pullRequest,
				...toPullRequestHeadRemoteInfo(pullRequestSummary),
			};
			if (input.mode === "local") {
				await this.checkoutPullRequest(input.cwd, normalizedReference, true);
				const details = await this.statusDetails(input.cwd);
				await this.configurePullRequestHeadUpstream(input.cwd, pullRequestWithRemoteInfo, details.branch ?? pullRequest.headBranch);
				return {
					pullRequest,
					branch: details.branch ?? pullRequest.headBranch,
					worktreePath: null,
				};
			}

			const localPullRequestBranch = resolvePullRequestWorktreeLocalBranchName(pullRequestWithRemoteInfo);
			const ensureExistingWorktreeUpstream = async (worktreePath: string): Promise<void> => {
				const details = await this.statusDetails(worktreePath);
				await this.configurePullRequestHeadUpstream(
					worktreePath,
					pullRequestWithRemoteInfo,
					details.branch ?? pullRequest.headBranch,
				);
			};
			const findLocalHeadBranch = async (cwd: string): Promise<GitBranch | null> => {
				const result = await this.listBranches({ cwd });
				const localBranch = result.branches.find(
					(branch) => !branch.isRemote && branch.name === localPullRequestBranch,
				);
				if (localBranch) {
					return localBranch;
				}
				if (localPullRequestBranch === pullRequest.headBranch) {
					return null;
				}
				return (
					result.branches.find(
						(branch) =>
							!branch.isRemote &&
							branch.name === pullRequest.headBranch &&
							branch.worktreePath !== null &&
							canonicalizeExistingPath(branch.worktreePath) !== rootWorktreePath,
					) ?? null
				);
			};

			const beforeFetch = await findLocalHeadBranch(input.cwd);
			const beforeFetchPath = beforeFetch?.worktreePath
				? canonicalizeExistingPath(beforeFetch.worktreePath)
				: null;
			if (beforeFetch?.worktreePath && beforeFetchPath !== rootWorktreePath) {
				await ensureExistingWorktreeUpstream(beforeFetch.worktreePath);
				return { pullRequest, branch: localPullRequestBranch, worktreePath: beforeFetch.worktreePath };
			}
			if (beforeFetchPath === rootWorktreePath) {
				throw gitManagerError(
					"preparePullRequestThread",
					"This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.",
				);
			}

			await this.materializePullRequestHeadBranch(input.cwd, pullRequestWithRemoteInfo, localPullRequestBranch);
			const afterFetch = await findLocalHeadBranch(input.cwd);
			const afterFetchPath = afterFetch?.worktreePath
				? canonicalizeExistingPath(afterFetch.worktreePath)
				: null;
			if (afterFetch?.worktreePath && afterFetchPath !== rootWorktreePath) {
				await ensureExistingWorktreeUpstream(afterFetch.worktreePath);
				return { pullRequest, branch: localPullRequestBranch, worktreePath: afterFetch.worktreePath };
			}
			if (afterFetchPath === rootWorktreePath) {
				throw gitManagerError(
					"preparePullRequestThread",
					"This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.",
				);
			}

			const worktree = await this.createWorktree({
				cwd: input.cwd,
				branch: localPullRequestBranch,
				path: null,
			});
			await ensureExistingWorktreeUpstream(worktree.worktree.path);
			return { pullRequest, branch: worktree.worktree.branch, worktreePath: worktree.worktree.path };
		} finally {
			this.invalidateStatus(input.cwd);
		}
	}

	async runStackedAction(
		input: GitRunStackedActionInput,
		progressReporter?: GitActionProgressReporter,
	): Promise<GitRunStackedActionResult> {
		const actionId = input.actionId || randomUUID();
		let currentPhase: GitActionProgressPhase | null = null;
		const emit = (event: GitActionProgressPayload): void => {
			const progressEvent: GitActionProgressEvent = {
				actionId,
				cwd: input.cwd,
				action: input.action,
				...event,
			};
			progressReporter?.(progressEvent);
		};
		try {
			const initialStatus = await this.statusDetails(input.cwd);
			const wantsCommit = isCommitAction(input.action);
			const wantsPush =
				input.action === "push" ||
				input.action === "commit_push" ||
				input.action === "commit_push_pr" ||
				(input.action === "create_pr" && (!initialStatus.hasUpstream || initialStatus.aheadCount > 0));
			const wantsPr = input.action === "create_pr" || input.action === "commit_push_pr";
			if (input.featureBranch && !wantsCommit) {
				throw gitManagerError("runStackedAction", "Feature-branch checkout is only supported for commit actions.");
			}
			if (input.action === "push" && initialStatus.hasWorkingTreeChanges) {
				throw gitManagerError("runStackedAction", "Commit or stash local changes before pushing.");
			}
			if (input.action === "create_pr" && initialStatus.hasWorkingTreeChanges) {
				throw gitManagerError("runStackedAction", "Commit local changes before creating a PR.");
			}
			const phases: GitActionProgressPhase[] = [
				...(input.featureBranch ? (["branch"] as const) : []),
				...(wantsCommit ? (["commit"] as const) : []),
				...(wantsPush ? (["push"] as const) : []),
				...(wantsPr ? (["pr"] as const) : []),
			];
			emit({ kind: "action_started", phases });
			if (!input.featureBranch && wantsPush && !initialStatus.branch) {
				throw gitManagerError("runStackedAction", "Cannot push from detached HEAD.");
			}
			if (!input.featureBranch && wantsPr && !initialStatus.branch) {
				throw gitManagerError("runStackedAction", "Cannot create a pull request from detached HEAD.");
			}

			let branchStep: GitRunStackedActionResult["branch"] = { status: "skipped_not_requested" };
			let commitMessageForStep = input.commitMessage;
			let preResolvedCommitSuggestion: CommitAndBranchSuggestion | undefined;
			if (input.featureBranch) {
				currentPhase = "branch";
				emit({ kind: "phase_started", phase: "branch", label: "Preparing feature branch..." });
				const result = await this.runFeatureBranchStep(
					input.cwd,
					initialStatus.branch,
					input.commitMessage,
					input.filePaths,
				);
				branchStep = result.branchStep;
				commitMessageForStep = result.resolvedCommitMessage;
				preResolvedCommitSuggestion = result.resolvedCommitSuggestion;
			}

			const currentBranch = branchStep.name ?? initialStatus.branch;
			const commitAction = isCommitAction(input.action) ? input.action : null;
			const commit: GitRunStackedActionResult["commit"] = commitAction
				? await (async () => {
						currentPhase = "commit";
						return this.runCommitStep(
							input.cwd,
							commitAction,
							currentBranch,
							commitMessageForStep,
							preResolvedCommitSuggestion,
							input.filePaths,
							emit,
						);
					})()
				: { status: "skipped_not_requested" };
			const push: GitRunStackedActionResult["push"] = wantsPush
				? await (async () => {
						currentPhase = "push";
						emit({ kind: "phase_started", phase: "push", label: "Pushing..." });
						return this.pushCurrentBranch(input.cwd, currentBranch);
					})()
				: { status: "skipped_not_requested" };
			const pr: GitRunStackedActionResult["pr"] = wantsPr
				? await (async () => {
						currentPhase = "pr";
						emit({ kind: "phase_started", phase: "pr", label: "Preparing PR..." });
						return this.runPrStep(input.cwd, currentBranch, emit);
					})()
				: { status: "skipped_not_requested" };
			const toast = await this.buildCompletionToast(input.cwd, {
				action: input.action,
				branch: branchStep,
				commit,
				push,
				pr,
			});
			const result = { action: input.action, branch: branchStep, commit, push, pr, toast };
			emit({ kind: "action_finished", result });
			return result;
		} catch (error) {
			emit({
				kind: "action_failed",
				phase: currentPhase,
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			this.invalidateStatus(input.cwd);
		}
	}

	private async executeGit(
		operation: string,
		cwd: string,
		args: readonly string[],
		options: Omit<ExecuteGitInput, "operation" | "cwd" | "args"> & {
			readonly fallbackErrorMessage?: string;
		} = {},
	): Promise<ExecuteGitResult> {
		const result = await this.execute({
			operation,
			cwd,
			args,
			...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
			...(options.env !== undefined ? { env: options.env } : {}),
			allowNonZeroExit: true,
			...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
			...(options.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
			...(options.truncateOutputAtMaxBytes !== undefined
				? { truncateOutputAtMaxBytes: options.truncateOutputAtMaxBytes }
				: {}),
			...(options.progress ? { progress: options.progress } : {}),
		});
		if (options.allowNonZeroExit || result.code === 0) {
			return result;
		}
		const stderr = result.stderr.trim();
		throw gitCommandError(
			operation,
			cwd,
			args,
			stderr || options.fallbackErrorMessage || `${gitCommandLabel(args)} failed: code=${result.code}`,
		);
	}

	private async gitStdout(
		operation: string,
		cwd: string,
		args: readonly string[],
		allowNonZeroExit = false,
	): Promise<string> {
		const result = await this.executeGit(operation, cwd, args, { allowNonZeroExit });
		return result.stdout;
	}

	private async gitStdoutWithOptions(
		operation: string,
		cwd: string,
		args: readonly string[],
		options: Omit<ExecuteGitInput, "operation" | "cwd" | "args"> = {},
	): Promise<string> {
		const result = await this.executeGit(operation, cwd, args, options);
		return result.stdoutTruncated ? `${result.stdout}${OUTPUT_TRUNCATED_MARKER}` : result.stdout;
	}

	private async originRemoteExists(cwd: string): Promise<boolean> {
		const result = await this.executeGit("GitCore.originRemoteExists", cwd, ["remote", "get-url", "origin"], {
			allowNonZeroExit: true,
		});
		return result.code === 0;
	}

	private async listRemoteNames(cwd: string): Promise<ReadonlyArray<string>> {
		return parseRemoteNamesInGitOrder(await this.gitStdout("GitCore.listRemoteNames", cwd, ["remote"]));
	}

	private async resolveCurrentUpstream(
		cwd: string,
	): Promise<{ upstreamRef: string; remoteName: string; upstreamBranch: string } | null> {
		const upstreamRef = (
			await this.gitStdout("GitCore.resolveCurrentUpstream", cwd, [
				"rev-parse",
				"--abbrev-ref",
				"--symbolic-full-name",
				"@{upstream}",
			], true)
		).trim();
		if (upstreamRef.length === 0 || upstreamRef === "@{upstream}") {
			return null;
		}
		const remoteNames = await this.gitStdout("GitCore.listRemoteNames", cwd, ["remote"])
			.then(parseRemoteNames)
			.catch(() => []);
		return parseUpstreamRefWithRemoteNames(upstreamRef, remoteNames) ?? parseUpstreamRefByFirstSeparator(upstreamRef);
	}

	private async resolveGitCommonDir(cwd: string): Promise<string> {
		const gitCommonDir = (
			await this.gitStdout("GitCore.resolveGitCommonDir", cwd, ["rev-parse", "--git-common-dir"])
		).trim();
		return path.isAbsolute(gitCommonDir) ? gitCommonDir : path.resolve(cwd, gitCommonDir);
	}

	private async refreshStatusUpstreamIfStale(cwd: string): Promise<void> {
		const upstream = await this.resolveCurrentUpstream(cwd);
		if (!upstream) {
			return;
		}
		const gitCommonDir = await this.resolveGitCommonDir(cwd);
		const cacheKey = `${gitCommonDir}\0${upstream.remoteName}`;
		const nextAllowedAt = this.upstreamRefreshCache.get(cacheKey) ?? 0;
		if (nextAllowedAt > Date.now()) {
			return;
		}
		try {
			const fetchCwd = path.basename(gitCommonDir) === ".git" ? path.dirname(gitCommonDir) : gitCommonDir;
			await this.executeGit(
				"GitCore.fetchRemoteForStatus",
				fetchCwd,
				["--git-dir", gitCommonDir, "fetch", "--quiet", "--no-tags", upstream.remoteName],
				{ allowNonZeroExit: true, timeoutMs: STATUS_UPSTREAM_REFRESH_TIMEOUT_MS },
			);
			// Cache successful remote status fetches briefly to avoid repeated network work.
			this.upstreamRefreshCache.set(cacheKey, Date.now() + STATUS_UPSTREAM_REFRESH_INTERVAL_MS);
		} catch {
			this.upstreamRefreshCache.set(cacheKey, Date.now() + STATUS_UPSTREAM_REFRESH_FAILURE_COOLDOWN_MS);
		}
	}

	private async resolveDefaultBranchName(cwd: string, remoteName: string): Promise<string | null> {
		const result = await this.executeGit("GitCore.resolveDefaultBranchName", cwd, [
			"symbolic-ref",
			`refs/remotes/${remoteName}/HEAD`,
		], { allowNonZeroExit: true });
		return result.code === 0 ? parseDefaultBranchFromRemoteHeadRef(result.stdout, remoteName) : null;
	}

	private async branchExists(cwd: string, branch: string): Promise<boolean> {
		return this.executeGit("GitCore.branchExists", cwd, [
			"show-ref",
			"--verify",
			"--quiet",
			`refs/heads/${branch}`,
		], { allowNonZeroExit: true, timeoutMs: 5_000 }).then((result) => result.code === 0);
	}

	private async remoteBranchExists(cwd: string, remoteName: string, branch: string): Promise<boolean> {
		return this.executeGit("GitCore.remoteBranchExists", cwd, [
			"show-ref",
			"--verify",
			"--quiet",
			`refs/remotes/${remoteName}/${branch}`,
		], { allowNonZeroExit: true }).then((result) => result.code === 0);
	}

	private async resolvePrimaryRemoteName(cwd: string): Promise<string> {
		if (await this.originRemoteExists(cwd)) {
			return "origin";
		}
		const [firstRemote] = await this.listRemoteNames(cwd);
		if (firstRemote) {
			return firstRemote;
		}
		throw gitCommandError("GitCore.resolvePrimaryRemoteName", cwd, ["remote"], "No git remote is configured for this repository.");
	}

	private async resolvePushRemoteName(cwd: string, branch: string): Promise<string | null> {
		const branchPushRemote = (
			await this.gitStdout("GitCore.resolvePushRemoteName.branchPushRemote", cwd, [
				"config",
				"--get",
				`branch.${branch}.pushRemote`,
			], true)
		).trim();
		if (branchPushRemote.length > 0) {
			return branchPushRemote;
		}
		const pushDefaultRemote = (
			await this.gitStdout("GitCore.resolvePushRemoteName.remotePushDefault", cwd, [
				"config",
				"--get",
				"remote.pushDefault",
			], true)
		).trim();
		if (pushDefaultRemote.length > 0) {
			return pushDefaultRemote;
		}
		return this.resolvePrimaryRemoteName(cwd).catch(() => null);
	}

	private async resolveBaseBranchForNoUpstream(cwd: string, branch: string): Promise<string | null> {
		const configuredBaseBranch = (
			await this.gitStdout("GitCore.resolveBaseBranchForNoUpstream.config", cwd, [
				"config",
				"--get",
				`branch.${branch}.gh-merge-base`,
			], true)
		).trim();
		const primaryRemoteName = await this.resolvePrimaryRemoteName(cwd).catch(() => null);
		const defaultBranch =
			primaryRemoteName === null ? null : await this.resolveDefaultBranchName(cwd, primaryRemoteName);
		const candidates = [
			configuredBaseBranch.length > 0 ? configuredBaseBranch : null,
			defaultBranch,
			...DEFAULT_BASE_BRANCH_CANDIDATES,
		];
		for (const candidate of candidates) {
			if (!candidate) {
				continue;
			}
			const remotePrefix = primaryRemoteName && primaryRemoteName !== "origin" ? `${primaryRemoteName}/` : null;
			const normalizedCandidate = candidate.startsWith("origin/")
				? candidate.slice("origin/".length)
				: remotePrefix && candidate.startsWith(remotePrefix)
					? candidate.slice(remotePrefix.length)
					: candidate;
			if (normalizedCandidate.length === 0 || normalizedCandidate === branch) {
				continue;
			}
			if (await this.branchExists(cwd, normalizedCandidate)) {
				return normalizedCandidate;
			}
			if (
				primaryRemoteName &&
				(await this.remoteBranchExists(cwd, primaryRemoteName, normalizedCandidate))
			) {
				return `${primaryRemoteName}/${normalizedCandidate}`;
			}
		}
		return null;
	}

	private async computeAheadCountAgainstBase(cwd: string, branch: string): Promise<number> {
		const baseBranch = await this.resolveBaseBranchForNoUpstream(cwd, branch).catch(() => null);
		if (!baseBranch) {
			return 0;
		}
		const result = await this.executeGit("GitCore.computeAheadCountAgainstBase", cwd, [
			"rev-list",
			"--count",
			`${baseBranch}..HEAD`,
		], { allowNonZeroExit: true });
		if (result.code !== 0) {
			return 0;
		}
		const parsed = Number.parseInt(result.stdout.trim(), 10);
		return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
	}

	private async statusDetailsLocal(cwd: string): Promise<GitStatusDetails> {
		const statusArgs = [
			...PROJECT_GIT_HARDENED_CONFIG_ARGS,
			"status",
			"--porcelain=2",
			"-z",
			"--branch",
			"--untracked-files=all",
		];
		const statusResult = await this.executeGit("GitCore.statusDetails.status", cwd, statusArgs, {
			allowNonZeroExit: true,
		}).catch((error: unknown) => {
			if (error instanceof GitCommandError && isMissingGitCwdError(error)) {
				return null;
			}
			throw error;
		});
		if (statusResult === null) {
			return NON_REPOSITORY_STATUS_DETAILS;
		}
		if (statusResult.code !== 0) {
			throw gitCommandError(
				"GitCore.statusDetails.status",
				cwd,
				statusArgs,
				statusResult.stderr.trim() || "git status failed",
			);
		}

		const [unstagedNumstatStdout, stagedNumstatStdout, defaultRefResult, hasOriginRemote] =
			await Promise.all([
				this.gitStdout("GitCore.statusDetails.unstagedNumstat", cwd, [
					...PROJECT_GIT_HARDENED_CONFIG_ARGS,
					"diff",
					"--numstat",
					"-z",
				]),
				this.gitStdout("GitCore.statusDetails.stagedNumstat", cwd, [
					...PROJECT_GIT_HARDENED_CONFIG_ARGS,
					"diff",
					"--cached",
					"--numstat",
					"-z",
				]),
				this.executeGit("GitCore.statusDetails.defaultRef", cwd, [
					"symbolic-ref",
					"refs/remotes/origin/HEAD",
				], { allowNonZeroExit: true }),
				this.originRemoteExists(cwd).catch(() => false),
			]);
		const defaultBranch =
			defaultRefResult.code === 0
				? defaultRefResult.stdout.trim().replace(/^refs\/remotes\/origin\//, "")
				: null;

		let branch: string | null = null;
		let upstreamRef: string | null = null;
		let aheadCount = 0;
		let behindCount = 0;
		let hasWorkingTreeChanges = false;
		const pathsWithoutNumstat = new Set<string>();
		const statusByPath = new Map<string, GitWorkingTreeFileStatus>();
		const porcelainFlagsByPath = new Map<string, WorkingTreeChangeFlags>();
		const previousPathByPath = new Map<string, string>();

		const statusRecords = splitNullSeparatedPaths(statusResult.stdout, false);
		for (let index = 0; index < statusRecords.length; index += 1) {
			const record = statusRecords[index] ?? "";
			if (record.startsWith("# branch.head ")) {
				const value = record.slice("# branch.head ".length).trim();
				branch = value.startsWith("(") ? null : value;
				continue;
			}
			if (record.startsWith("# branch.upstream ")) {
				const value = record.slice("# branch.upstream ".length).trim();
				upstreamRef = value.length > 0 ? value : null;
				continue;
			}
			if (record.startsWith("# branch.ab ")) {
				const parsed = parseBranchAb(record.slice("# branch.ab ".length).trim());
				aheadCount = parsed.ahead;
				behindCount = parsed.behind;
				continue;
			}
			if (record.length === 0 || record.startsWith("#")) {
				continue;
			}
			hasWorkingTreeChanges = true;
			if (record.startsWith("? ")) {
				const pathValue = parsePorcelainPathRecord(record);
				if (pathValue) {
					pokeWorkingTreeStatus(statusByPath, pathValue, "untracked");
					pokeWorkingTreeChangeFlags(porcelainFlagsByPath, pathValue, {
						staged: false,
						unstaged: true,
					});
					pathsWithoutNumstat.add(pathValue);
				}
				continue;
			}
			if (record.startsWith("! ")) {
				const pathValue = parsePorcelainPathRecord(record);
				if (pathValue) {
					pokeWorkingTreeStatus(statusByPath, pathValue, "ignored");
					pokeWorkingTreeChangeFlags(porcelainFlagsByPath, pathValue, {
						staged: false,
						unstaged: true,
					});
					pathsWithoutNumstat.add(pathValue);
				}
				continue;
			}
			const pathValue = parsePorcelainPathRecord(record);
			if (!pathValue) {
				continue;
			}
			pathsWithoutNumstat.add(pathValue);
			if (record.startsWith("u ")) {
				pokeWorkingTreeStatus(statusByPath, pathValue, "conflict");
				pokeWorkingTreeChangeFlags(porcelainFlagsByPath, pathValue, {
					staged: true,
					unstaged: true,
				});
				continue;
			}
			if (record.startsWith("2 ")) {
				pokeWorkingTreeChangeFlags(
					porcelainFlagsByPath,
					pathValue,
					parsePorcelainV2ChangeFlags(getPorcelainToken(record, 1) ?? ""),
				);
				const previousPath = statusRecords[index + 1] ?? null;
				if (previousPath !== null) {
					previousPathByPath.set(pathValue, previousPath);
					index += 1;
				}
				pokeWorkingTreeStatus(statusByPath, pathValue, "renamed");
				continue;
			}
			if (record.startsWith("1 ")) {
				const xyToken = getPorcelainToken(record, 1) ?? "";
				pokeWorkingTreeStatus(statusByPath, pathValue, classifyPorcelainV2Xy(xyToken));
				pokeWorkingTreeChangeFlags(porcelainFlagsByPath, pathValue, parsePorcelainV2ChangeFlags(xyToken));
			}
		}

		if (!upstreamRef && branch) {
			aheadCount = await this.computeAheadCountAgainstBase(cwd, branch).catch(() => 0);
			behindCount = 0;
		}

		const stagedEntries = parseNumstatEntries(stagedNumstatStdout);
		const unstagedEntries = parseNumstatEntries(unstagedNumstatStdout);
		const stagedPaths = new Set(stagedEntries.map((entry) => entry.path));
		const unstagedPaths = new Set(unstagedEntries.map((entry) => entry.path));
		const fileStatMap = new Map<string, { insertions: number; deletions: number }>();
		for (const entry of [...stagedEntries, ...unstagedEntries]) {
			const existing = fileStatMap.get(entry.path) ?? { insertions: 0, deletions: 0 };
			fileStatMap.set(entry.path, {
				insertions: existing.insertions + entry.insertions,
				deletions: existing.deletions + entry.deletions,
			});
		}

		let insertions = 0;
		let deletions = 0;
		const files = Array.from(fileStatMap.entries()).map(([filePath, stat]) => {
			insertions += stat.insertions;
			deletions += stat.deletions;
			const changeFlags = resolveWorkingTreeChangeFlags(
				filePath,
				stagedPaths,
				unstagedPaths,
				porcelainFlagsByPath,
			);
			return {
				path: filePath,
				...(previousPathByPath.get(filePath) ? { prevPath: previousPathByPath.get(filePath) } : {}),
				insertions: stat.insertions,
				deletions: stat.deletions,
				status: statusByPath.get(filePath) ?? "modified",
				staged: changeFlags.staged,
				unstaged: changeFlags.unstaged,
			};
		});

		for (const filePath of pathsWithoutNumstat) {
			if (fileStatMap.has(filePath)) {
				continue;
			}
			let stat = { insertions: 0, deletions: 0 };
			if (statusByPath.get(filePath) === "untracked") {
				stat = await this.gitStdoutWithOptions(
					"GitCore.statusDetails.untrackedNumstat",
					cwd,
					[
						...PROJECT_GIT_HARDENED_LITERAL_PATHSPECS_ARGS,
						"diff",
						"--no-index",
						"--numstat",
						"-z",
						"--",
						"/dev/null",
						filePath,
					],
					{
						allowNonZeroExit: true,
						maxOutputBytes: PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES,
						truncateOutputAtMaxBytes: true,
					},
				)
					.then((stdout) => parseFirstNumstatEntry(stdout) ?? stat)
					.catch(() => stat);
			}
			insertions += stat.insertions;
			deletions += stat.deletions;
			const changeFlags = resolveWorkingTreeChangeFlags(
				filePath,
				stagedPaths,
				unstagedPaths,
				porcelainFlagsByPath,
			);
			files.push({
				path: filePath,
				...(previousPathByPath.get(filePath) ? { prevPath: previousPathByPath.get(filePath) } : {}),
				insertions: stat.insertions,
				deletions: stat.deletions,
				status: statusByPath.get(filePath) ?? "modified",
				staged: changeFlags.staged,
				unstaged: changeFlags.unstaged,
			});
		}
		files.sort((a, b) => a.path.localeCompare(b.path));

		return {
			isRepo: true,
			hasOriginRemote,
			isDefaultBranch:
				branch !== null &&
				(branch === defaultBranch ||
					(defaultBranch === null && (branch === "main" || branch === "master"))),
			branch,
			upstreamRef,
			hasWorkingTreeChanges,
			workingTree: { files, insertions, deletions },
			hasUpstream: upstreamRef !== null,
			aheadCount,
			behindCount,
		};
	}

	private async statusDetails(cwd: string): Promise<GitStatusDetails> {
		await this.refreshStatusUpstreamIfStale(cwd).catch((error: unknown) => {
			if (error instanceof GitCommandError && isMissingGitCwdError(error)) {
				return;
			}
		});
		return this.statusDetailsLocal(cwd);
	}

	private async readLocalStatus(cwd: string): Promise<GitStatusLocalResult> {
		const details = await this.statusDetailsLocal(cwd).catch((error: unknown) => {
			if (error instanceof GitCommandError && isNotGitRepositoryError(error)) {
				return NON_REPOSITORY_STATUS_DETAILS;
			}
			throw error;
		});
		const hostingProvider = details.isRepo ? await this.resolveHostingProvider(cwd, details.branch) : null;
		return {
			isRepo: details.isRepo,
			...(hostingProvider ? { hostingProvider } : {}),
			hasOriginRemote: details.hasOriginRemote,
			isDefaultBranch: details.isDefaultBranch,
			branch: details.branch,
			hasWorkingTreeChanges: details.hasWorkingTreeChanges,
			workingTree: details.workingTree,
		};
	}

	private async readRemoteStatus(cwd: string): Promise<GitStatusRemoteResult | null> {
		const details = await this.statusDetails(cwd).catch((error: unknown) => {
			if (error instanceof GitCommandError && isNotGitRepositoryError(error)) {
				return null;
			}
			throw error;
		});
		if (details === null || !details.isRepo) {
			return null;
		}
		const pr =
			details.branch !== null
				? await this.findLatestPr(cwd, {
						branch: details.branch,
						upstreamRef: details.upstreamRef,
					})
						.then((latest) => (latest ? toStatusPr(latest) : null))
						.catch(() => null)
				: null;
		return {
			hasUpstream: details.hasUpstream,
			aheadCount: details.aheadCount,
			behindCount: details.behindCount,
			pr,
		};
	}

	private async readConfigValue(cwd: string, key: string): Promise<string | null> {
		const trimmed = (await this.gitStdout("GitCore.readConfigValue", cwd, ["config", "--get", key], true)).trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	private async readConfigValueNullable(cwd: string, key: string): Promise<string | null> {
		return this.readConfigValue(cwd, key).catch(() => null);
	}

	private async resolveHostingProvider(cwd: string, branch: string | null): Promise<GitStatusLocalResult["hostingProvider"] | null> {
		const preferredRemoteName =
			branch === null
				? "origin"
				: ((await this.readConfigValueNullable(cwd, `branch.${branch}.remote`)) ?? "origin");
		const remoteUrl =
			(await this.readConfigValueNullable(cwd, `remote.${preferredRemoteName}.url`)) ??
			(await this.readConfigValueNullable(cwd, "remote.origin.url"));
		return remoteUrl ? detectGitHostingProviderFromRemoteUrl(remoteUrl) : null;
	}

	private async readBranchRecency(cwd: string): Promise<Map<string, number>> {
		const branchRecency = await this.executeGit("GitCore.readBranchRecency", cwd, [
			"for-each-ref",
			"--format=%(refname:short)%09%(committerdate:unix)",
			"refs/heads",
			"refs/remotes",
		], { timeoutMs: 15_000, allowNonZeroExit: true });
		const branchLastCommit = new Map<string, number>();
		if (branchRecency.code !== 0) {
			return branchLastCommit;
		}
		for (const line of branchRecency.stdout.split("\n")) {
			if (line.length === 0) {
				continue;
			}
			const [name, lastCommitRaw] = line.split("\t");
			if (!name) {
				continue;
			}
			const lastCommit = Number.parseInt(lastCommitRaw ?? "0", 10);
			branchLastCommit.set(name, Number.isFinite(lastCommit) ? lastCommit : 0);
		}
		return branchLastCommit;
	}

	private async readWorktreeMap(stdout: string, ok: boolean): Promise<Map<string, string>> {
		const worktreeMap = new Map<string, string>();
		if (!ok) {
			return worktreeMap;
		}
		let currentPath: string | null = null;
		for (const line of stdout.split("\n")) {
			if (line.startsWith("worktree ")) {
				const candidatePath = line.slice("worktree ".length);
				currentPath = (await statFile(candidatePath)) ? candidatePath : null;
			} else if (line.startsWith("branch refs/heads/") && currentPath) {
				worktreeMap.set(line.slice("branch refs/heads/".length), currentPath);
			} else if (line === "") {
				currentPath = null;
			}
		}
		return worktreeMap;
	}

	private async prepareCommitContext(
		cwd: string,
		filePaths?: readonly string[],
	): Promise<GitPreparedCommitContext | null> {
		if (filePaths && filePaths.length > 0) {
			await this.executeGit("GitCore.prepareCommitContext.reset", cwd, [
				...PROJECT_GIT_HARDENED_CONFIG_ARGS,
				"reset",
			]).catch(() => undefined);
			await this.executeGit("GitCore.prepareCommitContext.addSelected", cwd, [
				...PROJECT_GIT_HARDENED_LITERAL_PATHSPECS_ARGS,
				"add",
				"-A",
				"--",
				...filePaths,
			]);
		} else {
			await this.executeGit("GitCore.prepareCommitContext.addAll", cwd, [
				...PROJECT_GIT_HARDENED_CONFIG_ARGS,
				"add",
				"-A",
			]);
		}
		const stagedSummary = (
			await this.gitStdout("GitCore.prepareCommitContext.stagedSummary", cwd, [
				...PROJECT_GIT_HARDENED_CONFIG_ARGS,
				"diff",
				"--cached",
				"--name-status",
			])
		).trim();
		if (stagedSummary.length === 0) {
			return null;
		}
		const stagedPatch = await this.gitStdoutWithOptions(
			"GitCore.prepareCommitContext.stagedPatch",
			cwd,
			[...PROJECT_GIT_HARDENED_CONFIG_ARGS, "diff", "--cached", "--patch", "--minimal"],
			{
				maxOutputBytes: PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES,
				truncateOutputAtMaxBytes: true,
			},
		);
		return { stagedSummary, stagedPatch };
	}

	private async commit(
		cwd: string,
		subject: string,
		body: string,
		progress?: (input: { readonly stream: "stdout" | "stderr"; readonly text: string }) => void,
	): Promise<{ readonly commitSha: string }> {
		const args = ["commit", "-m", subject];
		const trimmedBody = body.trim();
		if (trimmedBody.length > 0) {
			args.push("-m", trimmedBody);
		}
		const executeOptions: Omit<ExecuteGitInput, "operation" | "cwd" | "args"> = {
			timeoutMs: COMMIT_TIMEOUT_MS,
			...(progress
				? {
						progress: {
							onStdoutLine: (text) => progress({ stream: "stdout", text }),
							onStderrLine: (text) => progress({ stream: "stderr", text }),
						},
					}
				: {}),
		};
		await this.executeGit("GitCore.commit.commit", cwd, args, executeOptions);
		const commitSha = (await this.gitStdout("GitCore.commit.revParseHead", cwd, ["rev-parse", "HEAD"])).trim();
		return { commitSha };
	}

	private async pushCurrentBranch(cwd: string, fallbackBranch: string | null): Promise<GitPushResult> {
		const details = await this.statusDetails(cwd);
		const branch = details.branch ?? fallbackBranch;
		if (!branch) {
			throw gitCommandError("GitCore.pushCurrentBranch", cwd, ["push"], "Cannot push from detached HEAD.");
		}
		const hasNoLocalDelta = details.aheadCount === 0 && details.behindCount === 0;
		if (hasNoLocalDelta) {
			if (details.hasUpstream) {
				return {
					status: "skipped_up_to_date",
					branch,
					...(details.upstreamRef ? { upstreamBranch: details.upstreamRef } : {}),
				};
			}
			const comparableBaseBranch = await this.resolveBaseBranchForNoUpstream(cwd, branch).catch(() => null);
			if (comparableBaseBranch) {
				const publishRemoteName = await this.resolvePushRemoteName(cwd, branch).catch(() => null);
				if (!publishRemoteName) {
					return { status: "skipped_up_to_date", branch };
				}
				const hasRemoteBranch = await this.remoteBranchExists(cwd, publishRemoteName, branch).catch(() => false);
				if (hasRemoteBranch) {
					return { status: "skipped_up_to_date", branch };
				}
			}
		}
		if (!details.hasUpstream) {
			const publishRemoteName = await this.resolvePushRemoteName(cwd, branch);
			if (!publishRemoteName) {
				throw gitCommandError(
					"GitCore.pushCurrentBranch",
					cwd,
					["push"],
					"Cannot push because no git remote is configured for this repository.",
				);
			}
			await this.executeGit("GitCore.pushCurrentBranch.pushWithUpstream", cwd, [
				"push",
				"-u",
				publishRemoteName,
				`HEAD:refs/heads/${branch}`,
			]);
			return {
				status: "pushed",
				branch,
				upstreamBranch: `${publishRemoteName}/${branch}`,
				setUpstream: true,
			};
		}
		const currentUpstream = await this.resolveCurrentUpstream(cwd).catch(() => null);
		if (currentUpstream) {
			await this.executeGit("GitCore.pushCurrentBranch.pushUpstream", cwd, [
				"push",
				currentUpstream.remoteName,
				`HEAD:${currentUpstream.upstreamBranch}`,
			]);
			return {
				status: "pushed",
				branch,
				upstreamBranch: currentUpstream.upstreamRef,
				setUpstream: false,
			};
		}
		await this.executeGit("GitCore.pushCurrentBranch.push", cwd, ["push"]);
		return {
			status: "pushed",
			branch,
			...(details.upstreamRef ? { upstreamBranch: details.upstreamRef } : {}),
			setUpstream: false,
		};
	}

	private async pullCurrentBranch(cwd: string): Promise<GitPullResult> {
		const details = await this.statusDetails(cwd);
		const branch = details.branch;
		if (!branch) {
			throw gitCommandError("GitCore.pullCurrentBranch", cwd, ["pull", "--ff-only"], "Cannot pull from detached HEAD.");
		}
		if (!details.hasUpstream) {
			throw gitCommandError(
				"GitCore.pullCurrentBranch",
				cwd,
				["pull", "--ff-only"],
				"Current branch has no upstream configured. Push with upstream first.",
			);
		}
		const beforeSha = (await this.gitStdout("GitCore.pullCurrentBranch.beforeSha", cwd, ["rev-parse", "HEAD"], true)).trim();
		await this.executeGit("GitCore.pullCurrentBranch.pull", cwd, ["pull", "--ff-only"], {
			timeoutMs: 30_000,
			fallbackErrorMessage: "git pull failed",
		});
		const afterSha = (await this.gitStdout("GitCore.pullCurrentBranch.afterSha", cwd, ["rev-parse", "HEAD"], true)).trim();
		const refreshed = await this.statusDetails(cwd);
		this.invalidateStatus(cwd);
		return {
			status: beforeSha.length > 0 && beforeSha === afterSha ? "skipped_up_to_date" : "pulled",
			branch,
			upstreamBranch: refreshed.upstreamRef,
		};
	}

	private async readRangeContext(cwd: string, baseBranch: string): Promise<GitRangeContext> {
		const range = `${baseBranch}..HEAD`;
		const [commitSummary, diffSummary, diffPatch] = await Promise.all([
			this.gitStdoutWithOptions("GitCore.readRangeContext.log", cwd, ["log", "--oneline", range], {
				maxOutputBytes: RANGE_COMMIT_SUMMARY_MAX_OUTPUT_BYTES,
				truncateOutputAtMaxBytes: true,
			}),
			this.gitStdoutWithOptions("GitCore.readRangeContext.diffStat", cwd, ["diff", "--stat", range], {
				maxOutputBytes: RANGE_DIFF_SUMMARY_MAX_OUTPUT_BYTES,
				truncateOutputAtMaxBytes: true,
			}),
			this.gitStdoutWithOptions("GitCore.readRangeContext.diffPatch", cwd, [
				"diff",
				"--patch",
				"--minimal",
				range,
			], {
				maxOutputBytes: RANGE_DIFF_PATCH_MAX_OUTPUT_BYTES,
				truncateOutputAtMaxBytes: true,
			}),
		]);
		return { commitSummary, diffSummary, diffPatch };
	}

	private async listLocalBranchNames(cwd: string): Promise<string[]> {
		const stdout = await this.gitStdout("GitCore.listLocalBranchNames", cwd, [
			"branch",
			"--list",
			"--no-column",
			"--format=%(refname:short)",
		]);
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	private async ensureRemote(input: { readonly cwd: string; readonly preferredName: string; readonly url: string }): Promise<string> {
		const preferredName = sanitizeRemoteName(input.preferredName);
		const normalizedTargetUrl = normalizeRemoteUrl(input.url);
		const remoteFetchUrls = parseRemoteFetchUrls(
			await this.gitStdout("GitCore.ensureRemote.listRemoteUrls", input.cwd, ["remote", "-v"]),
		);
		for (const [remoteName, remoteUrl] of remoteFetchUrls.entries()) {
			if (normalizeRemoteUrl(remoteUrl) === normalizedTargetUrl) {
				return remoteName;
			}
		}
		let remoteName = preferredName;
		let suffix = 1;
		while (remoteFetchUrls.has(remoteName)) {
			remoteName = `${preferredName}-${suffix}`;
			suffix += 1;
		}
		await this.executeGit("GitCore.ensureRemote.add", input.cwd, ["remote", "add", remoteName, input.url]);
		return remoteName;
	}

	private async fetchPullRequestBranch(input: { readonly cwd: string; readonly prNumber: number; readonly branch: string }): Promise<void> {
		const remoteName = await this.resolvePrimaryRemoteName(input.cwd);
		await this.executeGit("GitCore.fetchPullRequestBranch", input.cwd, [
			"fetch",
			"--quiet",
			"--no-tags",
			remoteName,
			`+refs/pull/${input.prNumber}/head:refs/heads/${input.branch}`,
		], { fallbackErrorMessage: "git fetch pull request branch failed" });
	}

	private async fetchRemoteBranch(input: {
		readonly cwd: string;
		readonly remoteName: string;
		readonly remoteBranch: string;
		readonly localBranch: string;
	}): Promise<void> {
		await this.executeGit("GitCore.fetchRemoteBranch.fetch", input.cwd, [
			"fetch",
			"--quiet",
			"--no-tags",
			input.remoteName,
			`+refs/heads/${input.remoteBranch}:refs/remotes/${input.remoteName}/${input.remoteBranch}`,
		]);
		const localBranchAlreadyExists = await this.branchExists(input.cwd, input.localBranch);
		const targetRef = `${input.remoteName}/${input.remoteBranch}`;
		await this.executeGit(
			"GitCore.fetchRemoteBranch.materialize",
			input.cwd,
			localBranchAlreadyExists
				? ["branch", "--force", input.localBranch, targetRef]
				: ["branch", input.localBranch, targetRef],
		);
	}

	private async setBranchUpstream(input: {
		readonly cwd: string;
		readonly branch: string;
		readonly remoteName: string;
		readonly remoteBranch: string;
	}): Promise<void> {
		await this.executeGit("GitCore.setBranchUpstream", input.cwd, [
			"branch",
			"--set-upstream-to",
			`${input.remoteName}/${input.remoteBranch}`,
			input.branch,
		]);
	}

	private async runGh(cwd: string, args: readonly string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ExecuteGitResult> {
		try {
			return await runProcess("gh", args, {
				operation: "GitHubCli.execute",
				cwd,
				timeoutMs,
				maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
				truncateOutputAtMaxBytes: false,
			});
		} catch (error) {
			if (error instanceof Error) {
				const lower = error.message.toLowerCase();
				if (error.message.includes("Command not found: gh")) {
					throw gitHubCliError("execute", "GitHub CLI (`gh`) is required but not available on PATH.", error);
				}
				if (
					lower.includes("authentication failed") ||
					lower.includes("not logged in") ||
					lower.includes("gh auth login") ||
					lower.includes("no oauth token")
				) {
					throw gitHubCliError("execute", "GitHub CLI is not authenticated. Run `gh auth login` and retry.", error);
				}
				if (
					lower.includes("could not resolve to a pullrequest") ||
					lower.includes("repository.pullrequest") ||
					lower.includes("no pull requests found for branch") ||
					lower.includes("pull request not found")
				) {
					throw gitHubCliError("execute", "Pull request not found. Check the PR number or URL and try again.", error);
				}
				throw gitHubCliError("execute", `GitHub CLI command failed: ${error.message}`, error);
			}
			throw gitHubCliError("execute", "GitHub CLI command failed.", error);
		}
	}

	private async listOpenPullRequests(input: {
		readonly cwd: string;
		readonly headSelector: string;
		readonly limit?: number;
	}): Promise<ReadonlyArray<PullRequestInfo>> {
		const result = await this.runGh(input.cwd, [
			"pr",
			"list",
			"--head",
			input.headSelector,
			"--state",
			"open",
			"--limit",
			String(input.limit ?? 1),
			"--json",
			"number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
		]);
		const raw = result.stdout.trim();
		return raw.length === 0 ? [] : parseGitHubPullRequestListJson(raw);
	}

	private async getPullRequest(cwd: string, reference: string): Promise<GitHubPullRequestSummary> {
		const result = await this.runGh(cwd, [
			"pr",
			"view",
			reference,
			"--json",
			"number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
		]);
		return parseGitHubPullRequestJson(result.stdout.trim());
	}

	private async getRepositoryCloneUrls(cwd: string, repository: string): Promise<GitHubRepositoryCloneUrls> {
		const result = await this.runGh(cwd, ["repo", "view", repository, "--json", "nameWithOwner,url,sshUrl"]);
		return parseGitHubRepositoryCloneUrls(result.stdout.trim());
	}

	private async createPullRequest(input: {
		readonly cwd: string;
		readonly baseBranch: string;
		readonly headSelector: string;
		readonly title: string;
		readonly bodyFile: string;
	}): Promise<void> {
		await this.runGh(input.cwd, [
			"pr",
			"create",
			"--base",
			input.baseBranch,
			"--head",
			input.headSelector,
			"--title",
			input.title,
			"--body-file",
			input.bodyFile,
		]);
	}

	private async getDefaultBranch(cwd: string): Promise<string | null> {
		const result = await this.runGh(cwd, [
			"repo",
			"view",
			"--json",
			"defaultBranchRef",
			"--jq",
			".defaultBranchRef.name",
		]);
		const trimmed = result.stdout.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	private async checkoutPullRequest(cwd: string, reference: string, force: boolean): Promise<void> {
		await this.runGh(cwd, ["pr", "checkout", reference, ...(force ? ["--force"] : [])]);
	}

	private async configurePullRequestHeadUpstream(
		cwd: string,
		pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
		localBranch = pullRequest.headBranch,
	): Promise<void> {
		const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(pullRequest) ?? "";
		if (repositoryNameWithOwner.length === 0) {
			return;
		}
		try {
			const cloneUrls = await this.getRepositoryCloneUrls(cwd, repositoryNameWithOwner);
			const originRemoteUrl = await this.readConfigValue(cwd, "remote.origin.url");
			const remoteUrl = shouldPreferSshRemote(originRemoteUrl) ? cloneUrls.sshUrl : cloneUrls.url;
			const preferredRemoteName =
				pullRequest.headRepositoryOwnerLogin?.trim() ||
				repositoryNameWithOwner.split("/")[0]?.trim() ||
				"fork";
			const remoteName = await this.ensureRemote({ cwd, preferredName: preferredRemoteName, url: remoteUrl });
			await this.setBranchUpstream({
				cwd,
				branch: localBranch,
				remoteName,
				remoteBranch: pullRequest.headBranch,
			});
		} catch {
			return;
		}
	}

	private async materializePullRequestHeadBranch(
		cwd: string,
		pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
		localBranch = pullRequest.headBranch,
	): Promise<void> {
		const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(pullRequest) ?? "";
		if (repositoryNameWithOwner.length === 0) {
			await this.fetchPullRequestBranch({ cwd, prNumber: pullRequest.number, branch: localBranch });
			return;
		}
		try {
			const cloneUrls = await this.getRepositoryCloneUrls(cwd, repositoryNameWithOwner);
			const originRemoteUrl = await this.readConfigValue(cwd, "remote.origin.url");
			const remoteUrl = shouldPreferSshRemote(originRemoteUrl) ? cloneUrls.sshUrl : cloneUrls.url;
			const preferredRemoteName =
				pullRequest.headRepositoryOwnerLogin?.trim() ||
				repositoryNameWithOwner.split("/")[0]?.trim() ||
				"fork";
			const remoteName = await this.ensureRemote({ cwd, preferredName: preferredRemoteName, url: remoteUrl });
			await this.fetchRemoteBranch({
				cwd,
				remoteName,
				remoteBranch: pullRequest.headBranch,
				localBranch,
			});
			await this.setBranchUpstream({
				cwd,
				branch: localBranch,
				remoteName,
				remoteBranch: pullRequest.headBranch,
			});
		} catch {
			await this.fetchPullRequestBranch({ cwd, prNumber: pullRequest.number, branch: localBranch });
		}
	}

	private async resolveRemoteRepositoryContext(
		cwd: string,
		remoteName: string | null,
	): Promise<{ readonly repositoryNameWithOwner: string | null; readonly ownerLogin: string | null }> {
		if (!remoteName) {
			return { repositoryNameWithOwner: null, ownerLogin: null };
		}
		const remoteUrl = await this.readConfigValueNullable(cwd, `remote.${remoteName}.url`);
		const repositoryNameWithOwner = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remoteUrl);
		return { repositoryNameWithOwner, ownerLogin: parseRepositoryOwnerLogin(repositoryNameWithOwner) };
	}

	private async resolveBranchHeadContext(
		cwd: string,
		details: { readonly branch: string; readonly upstreamRef: string | null },
	): Promise<BranchHeadContext> {
		const remoteName = await this.readConfigValueNullable(cwd, `branch.${details.branch}.remote`);
		const headBranchFromUpstream = details.upstreamRef
			? extractBranchNameFromRemoteRef(details.upstreamRef, { remoteName })
			: "";
		const headBranch = headBranchFromUpstream.length > 0 ? headBranchFromUpstream : details.branch;
		const shouldProbeLocalBranchSelector = headBranchFromUpstream.length === 0 || headBranch === details.branch;
		const [remoteRepository, originRepository] = await Promise.all([
			this.resolveRemoteRepositoryContext(cwd, remoteName),
			this.resolveRemoteRepositoryContext(cwd, "origin"),
		]);
		const isCrossRepository =
			remoteRepository.repositoryNameWithOwner !== null && originRepository.repositoryNameWithOwner !== null
				? remoteRepository.repositoryNameWithOwner.toLowerCase() !==
					originRepository.repositoryNameWithOwner.toLowerCase()
				: remoteName !== null && remoteName !== "origin" && remoteRepository.repositoryNameWithOwner !== null;
		const ownerHeadSelector =
			remoteRepository.ownerLogin && headBranch.length > 0
				? `${remoteRepository.ownerLogin}:${headBranch}`
				: null;
		const remoteAliasHeadSelector = remoteName && headBranch.length > 0 ? `${remoteName}:${headBranch}` : null;
		const shouldProbeRemoteOwnedSelectors = isCrossRepository || (remoteName !== null && remoteName !== "origin");
		const headSelectors: string[] = [];
		if (isCrossRepository && shouldProbeRemoteOwnedSelectors) {
			appendUnique(headSelectors, ownerHeadSelector);
			appendUnique(headSelectors, remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null);
		}
		if (shouldProbeLocalBranchSelector) {
			appendUnique(headSelectors, details.branch);
		}
		appendUnique(headSelectors, headBranch !== details.branch ? headBranch : null);
		if (!isCrossRepository && shouldProbeRemoteOwnedSelectors) {
			appendUnique(headSelectors, ownerHeadSelector);
			appendUnique(headSelectors, remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null);
		}
		return {
			localBranch: details.branch,
			headBranch,
			headSelectors,
			preferredHeadSelector: ownerHeadSelector && isCrossRepository ? ownerHeadSelector : headBranch,
			remoteName,
			headRepositoryNameWithOwner: remoteRepository.repositoryNameWithOwner,
			headRepositoryOwnerLogin: remoteRepository.ownerLogin,
			isCrossRepository,
		};
	}

	private async findOpenPr(cwd: string, headContext: BranchHeadContext): Promise<PullRequestInfo | null> {
		for (const headSelector of headContext.headSelectors) {
			const pullRequests = await this.listOpenPullRequests({ cwd, headSelector, limit: 1 });
			const firstPullRequest = pullRequests.find((pullRequest) =>
				matchesBranchHeadContext(pullRequest, headContext),
			);
			if (firstPullRequest) {
				return { ...firstPullRequest, state: "open", updatedAt: null };
			}
		}
		return null;
	}

	private async findLatestPr(
		cwd: string,
		details: { readonly branch: string; readonly upstreamRef: string | null },
	): Promise<PullRequestInfo | null> {
		const cacheKey = `${normalizeCwd(cwd)}\0${details.branch}\0${details.upstreamRef ?? ""}`;
		const cached = this.latestPrCache.get(cacheKey);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.value;
		}
		const headContext = await this.resolveBranchHeadContext(cwd, details);
		const parsedByNumber = new Map<number, PullRequestInfo>();
		for (const headSelector of headContext.headSelectors) {
			const stdout = (
				await this.runGh(cwd, [
					"pr",
					"list",
					"--head",
					headSelector,
					"--state",
					"all",
					"--limit",
					"20",
					"--json",
					"number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt,isCrossRepository,headRepository,headRepositoryOwner",
				])
			).stdout;
			const raw = stdout.trim();
			if (raw.length === 0) {
				continue;
			}
			for (const pr of parseGitHubPullRequestListJson(raw)) {
				if (matchesBranchHeadContext(pr, headContext)) {
					parsedByNumber.set(pr.number, pr);
				}
			}
		}
		const parsed = Array.from(parsedByNumber.values()).toSorted((a, b) => {
			const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
			const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
			return right - left;
		});
		const latest = parsed.find((pr) => pr.state === "open") ?? parsed[0] ?? null;
		this.latestPrCache.set(cacheKey, {
			value: latest,
			fingerprint: fingerprintStatusPart(latest),
			expiresAt: Date.now() + STATUS_LATEST_PR_CACHE_TTL_MS,
		});
		return latest;
	}

	private async resolveBaseBranch(
		cwd: string,
		branch: string,
		upstreamRef: string | null,
		headContext: Pick<BranchHeadContext, "isCrossRepository" | "remoteName">,
	): Promise<string> {
		const configured = await this.readConfigValue(cwd, `branch.${branch}.gh-merge-base`);
		if (configured) {
			return configured;
		}
		if (upstreamRef && !headContext.isCrossRepository) {
			const upstreamBranch = extractBranchNameFromRemoteRef(upstreamRef, {
				remoteName: headContext.remoteName,
			});
			if (upstreamBranch.length > 0 && upstreamBranch !== branch) {
				return upstreamBranch;
			}
		}
		return (await this.getDefaultBranch(cwd).catch(() => null)) ?? "main";
	}

	private async resolveCommitAndBranchSuggestion(input: {
		readonly cwd: string;
		readonly branch: string | null;
		readonly commitMessage?: string;
		readonly includeBranch?: boolean;
		readonly filePaths?: readonly string[];
	}): Promise<CommitAndBranchSuggestion | null> {
		const context = await this.prepareCommitContext(input.cwd, input.filePaths);
		if (!context) {
			return null;
		}
		const customCommit = parseCustomCommitMessage(input.commitMessage ?? "");
		if (customCommit) {
			return {
				subject: customCommit.subject,
				body: customCommit.body,
				...(input.includeBranch ? { branch: sanitizeFeatureBranchName(customCommit.subject) } : {}),
				commitMessage: formatCommitMessage(customCommit.subject, customCommit.body),
			};
		}
		// Empty commit/branch messages used to delegate to text generation. This desktop-local aux
		// slice keeps a deterministic fallback without inventing an AI integration.
		const firstChangedPath = context.stagedSummary.split(/\r?\n/g)[0]?.split(/\s+/g).pop() ?? "project files";
		const subject = `Update ${firstChangedPath}`.slice(0, 72).trimEnd();
		const body = context.stagedSummary;
		return {
			subject,
			body,
			...(input.includeBranch ? { branch: sanitizeFeatureBranchName(subject) } : {}),
			commitMessage: formatCommitMessage(subject, body),
		};
	}

	private async runFeatureBranchStep(
		cwd: string,
		branch: string | null,
		commitMessage?: string,
		filePaths?: readonly string[],
	): Promise<{
		readonly branchStep: { readonly status: "created"; readonly name: string };
		readonly resolvedCommitMessage: string;
		readonly resolvedCommitSuggestion: CommitAndBranchSuggestion;
	}> {
		const suggestion = await this.resolveCommitAndBranchSuggestion({
			cwd,
			branch,
			...(commitMessage ? { commitMessage } : {}),
			...(filePaths ? { filePaths } : {}),
			includeBranch: true,
		});
		if (!suggestion) {
			throw gitManagerError("runFeatureBranchStep", "Cannot create a feature branch because there are no changes to commit.");
		}
		const preferredBranch = suggestion.branch ?? sanitizeFeatureBranchName(suggestion.subject);
		const existingBranchNames = await this.listLocalBranchNames(cwd);
		const resolvedBranch = resolveAutoFeatureBranchName(existingBranchNames, preferredBranch);
		await this.createBranch({ cwd, branch: resolvedBranch });
		await this.checkout({ cwd, branch: resolvedBranch });
		return {
			branchStep: { status: "created", name: resolvedBranch },
			resolvedCommitMessage: suggestion.commitMessage,
			resolvedCommitSuggestion: suggestion,
		};
	}

	private async runCommitStep(
		cwd: string,
		action: "commit" | "commit_push" | "commit_push_pr",
		branch: string | null,
		commitMessage: string | undefined,
		preResolvedSuggestion: CommitAndBranchSuggestion | undefined,
		filePaths: readonly string[] | undefined,
		emit: (event: GitActionProgressPayload) => void,
	): Promise<GitRunStackedActionResult["commit"]> {
		let suggestion = preResolvedSuggestion;
		if (!suggestion) {
			if (!commitMessage?.trim()) {
				emit({ kind: "phase_started", phase: "commit", label: "Preparing commit message..." });
			}
			suggestion = await this.resolveCommitAndBranchSuggestion({
				cwd,
				branch,
				...(commitMessage ? { commitMessage } : {}),
				...(filePaths ? { filePaths } : {}),
			}) ?? undefined;
		}
		if (!suggestion) {
			return { status: "skipped_no_changes" };
		}
		emit({ kind: "phase_started", phase: "commit", label: "Committing..." });
		const { commitSha } = await this.commit(cwd, suggestion.subject, suggestion.body, ({ stream, text }) => {
			const sanitized = sanitizeProgressText(text);
			if (!sanitized) {
				return;
			}
			emit({ kind: "hook_output", hookName: null, stream, text: sanitized });
		});
		return { status: "created", commitSha, subject: suggestion.subject };
	}

	private async runPrStep(
		cwd: string,
		fallbackBranch: string | null,
		emit: (event: GitActionProgressPayload) => void,
	): Promise<GitRunStackedActionResult["pr"]> {
		const details = await this.statusDetails(cwd);
		const branch = details.branch ?? fallbackBranch;
		if (!branch) {
			throw gitManagerError("runPrStep", "Cannot create a pull request from detached HEAD.");
		}
		if (!details.hasUpstream) {
			throw gitManagerError("runPrStep", "Current branch has not been pushed. Push before creating a PR.");
		}
		const headContext = await this.resolveBranchHeadContext(cwd, {
			branch,
			upstreamRef: details.upstreamRef,
		});
		const existing = await this.findOpenPr(cwd, headContext);
		if (existing) {
			return {
				status: "opened_existing",
				url: existing.url,
				number: existing.number,
				baseBranch: existing.baseRefName,
				headBranch: existing.headRefName,
				title: existing.title,
			};
		}
		const baseBranch = await this.resolveBaseBranch(cwd, branch, details.upstreamRef, headContext);
		emit({ kind: "phase_started", phase: "pr", label: "Preparing PR content..." });
		const rangeContext = await this.readRangeContext(cwd, baseBranch);
		const latestSubject = (await this.gitStdout("GitCore.runPrStep.latestSubject", cwd, [
			"log",
			"-1",
			"--pretty=%s",
		], true)).trim();
		const title = latestSubject.length > 0 ? latestSubject : `Update ${headContext.headBranch}`;
		const body = [
			"## Summary",
			"",
			rangeContext.commitSummary.trim() || "Changes prepared from local commits.",
			"",
			"## Diff Stat",
			"",
			rangeContext.diffSummary.trim() || "No diff stat available.",
		].join("\n");
		const bodyFile = path.join(this.tmpDir, `honk-pr-body-${process.pid}-${randomUUID()}.md`);
		await fs.writeFile(bodyFile, body, "utf8");
		try {
			emit({ kind: "phase_started", phase: "pr", label: "Creating GitHub pull request..." });
			await this.createPullRequest({
				cwd,
				baseBranch,
				headSelector: headContext.preferredHeadSelector,
				title,
				bodyFile,
			});
		} finally {
			await fs.rm(bodyFile, { force: true });
		}
		const created = await this.findOpenPr(cwd, headContext);
		if (!created) {
			return { status: "created", baseBranch, headBranch: headContext.headBranch, title };
		}
		return {
			status: "created",
			url: created.url,
			number: created.number,
			baseBranch: created.baseRefName,
			headBranch: created.headRefName,
			title: created.title,
		};
	}

	private async buildCompletionToast(
		cwd: string,
		result: Pick<GitRunStackedActionResult, "action" | "branch" | "commit" | "push" | "pr">,
	): Promise<GitRunStackedActionResult["toast"]> {
		const summary = summarizeGitActionResult(result);
		let latestOpenPr: PullRequestInfo | null = null;
		let currentBranchIsDefault = false;
		let finalBranchContext: { branch: string; upstreamRef: string | null; hasUpstream: boolean } | null = null;
		if (result.action !== "commit") {
			const finalStatus = await this.statusDetails(cwd);
			if (finalStatus.branch) {
				finalBranchContext = {
					branch: finalStatus.branch,
					upstreamRef: finalStatus.upstreamRef,
					hasUpstream: finalStatus.hasUpstream,
				};
				currentBranchIsDefault = finalStatus.isDefaultBranch;
			}
		}
		const explicitResultPr =
			(result.pr.status === "created" || result.pr.status === "opened_existing") && result.pr.url
				? { url: result.pr.url, state: "open" as const }
				: null;
		const shouldLookupExistingOpenPr =
			(result.action === "commit_push" || result.action === "push") &&
			result.push.status === "pushed" &&
			result.branch.status !== "created" &&
			!currentBranchIsDefault &&
			explicitResultPr === null &&
			finalBranchContext?.hasUpstream === true;
		if (shouldLookupExistingOpenPr && finalBranchContext) {
			latestOpenPr = await this.resolveBranchHeadContext(cwd, {
				branch: finalBranchContext.branch,
				upstreamRef: finalBranchContext.upstreamRef,
			})
				.then((headContext) => this.findOpenPr(cwd, headContext))
				.catch(() => null);
		}
		const openPr = latestOpenPr ?? explicitResultPr;
		const cta =
			result.action === "commit" && result.commit.status === "created"
				? { kind: "run_action" as const, label: "Push", action: { kind: "push" as const } }
				: (result.action === "push" ||
							result.action === "create_pr" ||
							result.action === "commit_push" ||
							result.action === "commit_push_pr") &&
						openPr?.url &&
						(!currentBranchIsDefault ||
							result.pr.status === "created" ||
							result.pr.status === "opened_existing")
					? { kind: "open_pr" as const, label: "View PR", url: openPr.url }
					: (result.action === "push" || result.action === "commit_push") &&
							result.push.status === "pushed" &&
							!currentBranchIsDefault
						? {
								kind: "run_action" as const,
								label: "Create PR",
								action: { kind: "create_pr" as const },
							}
						: { kind: "none" as const };
		return { ...summary, cta };
	}

	private getCachedStatus(cwd: string): CachedGitStatus | null {
		return this.statusCache.get(cwd) ?? null;
	}

	private updateCachedLocalStatus(
		cwd: string,
		local: GitStatusLocalResult,
		options?: { readonly publish?: boolean; readonly forcePublish?: boolean },
	): GitStatusLocalResult {
		const nextLocal = {
			fingerprint: fingerprintStatusPart(local),
			value: local,
			expiresAt: Number.POSITIVE_INFINITY,
		};
		const previous = this.statusCache.get(cwd) ?? { local: null, remote: null };
		const shouldPublish = previous.local?.fingerprint !== nextLocal.fingerprint;
		this.statusCache.set(cwd, { ...previous, local: nextLocal });
		if (options?.publish && (shouldPublish || options.forcePublish)) {
			this.publishStatus(cwd, { _tag: "localUpdated", local });
		}
		return local;
	}

	private updateCachedRemoteStatus(
		cwd: string,
		remote: GitStatusRemoteResult | null,
		options?: { readonly publish?: boolean },
	): GitStatusRemoteResult | null {
		const nextRemote = {
			fingerprint: fingerprintStatusPart(remote),
			value: remote,
			expiresAt: Number.POSITIVE_INFINITY,
		};
		const previous = this.statusCache.get(cwd) ?? { local: null, remote: null };
		const shouldPublish = previous.remote?.fingerprint !== nextRemote.fingerprint;
		this.statusCache.set(cwd, { ...previous, remote: nextRemote });
		if (options?.publish && shouldPublish) {
			this.publishStatus(cwd, { _tag: "remoteUpdated", remote });
		}
		return remote;
	}

	private async getOrLoadLocalStatus(cwd: string): Promise<GitStatusLocalResult> {
		const cached = this.getCachedStatus(cwd);
		if (cached?.local) {
			return cached.local.value;
		}
		const local = await this.localStatus({ cwd });
		return this.updateCachedLocalStatus(cwd, local);
	}

	private async refreshLocalStatus(cwd: string, forcePublish = false): Promise<GitStatusLocalResult> {
		const normalizedCwd = normalizeCwd(cwd);
		this.invalidateLocalStatus(normalizedCwd);
		const local = await this.localStatus({ cwd: normalizedCwd });
		return this.updateCachedLocalStatus(normalizedCwd, local, {
			publish: true,
			forcePublish,
		});
	}

	private async refreshRemoteStatus(cwd: string): Promise<GitStatusRemoteResult | null> {
		const normalizedCwd = normalizeCwd(cwd);
		this.invalidateRemoteStatus(normalizedCwd);
		const remote = await this.remoteStatus({ cwd: normalizedCwd });
		return this.updateCachedRemoteStatus(normalizedCwd, remote, { publish: true });
	}

	private publishStatus(cwd: string, event: GitStatusStreamEvent): void {
		const listeners = this.statusListeners.get(cwd);
		if (!listeners) {
			return;
		}
		for (const listener of listeners) {
			listener(event);
		}
	}

	private retainLocalWatcher(cwd: string): void {
		const existing = this.localWatchers.get(cwd);
		if (existing) {
			existing.subscriberCount += 1;
			return;
		}
		const watcher: ActiveLocalWatcher = {
			subscriberCount: 1,
			watcher: null,
			timer: null,
			cooldownTimer: null,
			cooling: false,
			pending: false,
		};
		this.localWatchers.set(cwd, watcher);
		try {
			watcher.watcher = watch(cwd, { recursive: true }, (_eventType, filename) => {
				if (!shouldIgnoreGitWatchPath(filename)) {
					this.requestLocalWatcherRefresh(cwd, watcher);
				}
			});
			watcher.watcher.on("error", () => undefined);
		} catch {
			return;
		}
	}

	private releaseLocalWatcher(cwd: string): void {
		const existing = this.localWatchers.get(cwd);
		if (!existing) {
			return;
		}
		if (existing.subscriberCount > 1) {
			existing.subscriberCount -= 1;
			return;
		}
		this.closeLocalWatcher(existing);
		this.localWatchers.delete(cwd);
	}

	private closeLocalWatcher(watcher: ActiveLocalWatcher): void {
		watcher.watcher?.close();
		if (watcher.timer) {
			clearTimeout(watcher.timer);
		}
		if (watcher.cooldownTimer) {
			clearTimeout(watcher.cooldownTimer);
		}
	}

	private requestLocalWatcherRefresh(cwd: string, watcher: ActiveLocalWatcher): void {
		if (watcher.cooling) {
			watcher.pending = true;
			return;
		}
		if (watcher.timer) {
			clearTimeout(watcher.timer);
		}
		// Debounce local watch events, then cool down to avoid status refresh storms.
		watcher.timer = setTimeout(() => {
			watcher.timer = null;
			void this.refreshLocalStatus(cwd, true)
				.catch(() => undefined)
				.finally(() => {
					watcher.cooling = true;
					watcher.cooldownTimer = setTimeout(() => {
						watcher.cooling = false;
						watcher.cooldownTimer = null;
						if (watcher.pending) {
							watcher.pending = false;
							this.requestLocalWatcherRefresh(cwd, watcher);
						}
					}, GIT_STATUS_LOCAL_WATCH_COOLDOWN_MS);
				});
		}, GIT_STATUS_LOCAL_WATCH_DEBOUNCE_MS);
	}

	private retainRemotePoller(cwd: string): void {
		const existing = this.remotePollers.get(cwd);
		if (existing) {
			existing.subscriberCount += 1;
			return;
		}
		const poller: ActiveRemotePoller = {
			subscriberCount: 1,
			timer: null,
			stopped: false,
			consecutiveFailures: 0,
		};
		this.remotePollers.set(cwd, poller);
		this.runRemotePoll(cwd, poller, 0);
	}

	private releaseRemotePoller(cwd: string): void {
		const existing = this.remotePollers.get(cwd);
		if (!existing) {
			return;
		}
		if (existing.subscriberCount > 1) {
			existing.subscriberCount -= 1;
			return;
		}
		existing.stopped = true;
		if (existing.timer) {
			clearTimeout(existing.timer);
		}
		this.remotePollers.delete(cwd);
	}

	private runRemotePoll(cwd: string, poller: ActiveRemotePoller, delayMs: number): void {
		if (this.disposed || poller.stopped) {
			return;
		}
		poller.timer = setTimeout(() => {
			poller.timer = null;
			void this.refreshRemoteStatus(cwd)
				.then(() => {
					poller.consecutiveFailures = 0;
					this.runRemotePoll(cwd, poller, GIT_STATUS_REFRESH_INTERVAL_MS);
				})
				.catch(() => {
					poller.consecutiveFailures += 1;
					this.runRemotePoll(cwd, poller, remoteRefreshFailureDelay(poller.consecutiveFailures));
				});
		}, delayMs);
	}
}

interface CommitAndBranchSuggestion {
	readonly subject: string;
	readonly body: string;
	readonly branch?: string;
	readonly commitMessage: string;
}

interface RunProcessOptions {
	readonly operation: string;
	readonly cwd: string;
	readonly stdin?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly allowNonZeroExit?: boolean;
	readonly timeoutMs?: number;
	readonly maxOutputBytes?: number;
	readonly truncateOutputAtMaxBytes?: boolean;
	readonly progress?: ExecuteGitProgress;
}

function runProcess(
	command: "git" | "gh",
	args: ReadonlyArray<string>,
	options: RunProcessOptions,
): Promise<ExecuteGitResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
	const truncateOutputAtMaxBytes = options.truncateOutputAtMaxBytes ?? false;
	return new Promise<ExecuteGitResult>((resolve, reject) => {
		const child = spawn(command, [...args], {
			cwd: options.cwd,
			env: {
				...process.env,
				...options.env,
			},
			stdio: ["pipe", "pipe", "pipe"],
		});
		let settled = false;
		let stdout = "";
		let stderr = "";
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let stdoutTruncated = false;
		let stderrTruncated = false;
		let stdoutLineBuffer = "";
		let stderrLineBuffer = "";

		const finish = (result: ExecuteGitResult): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			if (!options.allowNonZeroExit && result.code !== 0) {
				const trimmedStderr = result.stderr.trim();
				reject(
					command === "git"
						? gitCommandError(
								options.operation,
								options.cwd,
								args,
								trimmedStderr.length > 0
									? `${gitCommandLabel(args)} failed: ${trimmedStderr}`
									: `${gitCommandLabel(args)} failed with code ${result.code}.`,
							)
						: new Error(
								trimmedStderr.length > 0
									? `${commandLabel(command, args)} failed: ${trimmedStderr}`
									: `${commandLabel(command, args)} failed with code ${result.code}.`,
							),
				);
				return;
			}
			resolve(result);
		};

		const fail = (error: unknown): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			reject(
				command === "git"
					? gitCommandError(
							options.operation,
							options.cwd,
							args,
							error instanceof Error ? error.message : String(error),
							error,
						)
					: error,
			);
		};

		const emitLines = (stream: "stdout" | "stderr", chunk: string, flush: boolean): void => {
			let buffer = stream === "stdout" ? stdoutLineBuffer : stderrLineBuffer;
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex >= 0) {
				const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
				buffer = buffer.slice(newlineIndex + 1);
				if (line.length > 0) {
					if (stream === "stdout") {
						options.progress?.onStdoutLine?.(line);
					} else {
						options.progress?.onStderrLine?.(line);
					}
				}
				newlineIndex = buffer.indexOf("\n");
			}
			if (flush && buffer.length > 0) {
				const line = buffer.replace(/\r$/, "");
				if (line.length > 0) {
					if (stream === "stdout") {
						options.progress?.onStdoutLine?.(line);
					} else {
						options.progress?.onStderrLine?.(line);
					}
				}
				buffer = "";
			}
			if (stream === "stdout") {
				stdoutLineBuffer = buffer;
			} else {
				stderrLineBuffer = buffer;
			}
		};

		const collect = (stream: "stdout" | "stderr", chunk: Buffer): void => {
			const currentBytes = stream === "stdout" ? stdoutBytes : stderrBytes;
			const nextBytes = currentBytes + chunk.byteLength;
			if (!truncateOutputAtMaxBytes && nextBytes > maxOutputBytes) {
				fail(
					command === "git"
						? gitCommandError(
								options.operation,
								options.cwd,
								args,
								`${gitCommandLabel(args)} output exceeded ${maxOutputBytes} bytes and was truncated.`,
							)
						: new Error(`${commandLabel(command, args)} output exceeded ${maxOutputBytes} bytes.`),
				);
				child.kill("SIGTERM");
				return;
			}
			const alreadyTruncated = stream === "stdout" ? stdoutTruncated : stderrTruncated;
			if (truncateOutputAtMaxBytes && alreadyTruncated) {
				return;
			}
			const chunkToDecode =
				truncateOutputAtMaxBytes && nextBytes > maxOutputBytes
					? chunk.subarray(0, Math.max(0, maxOutputBytes - currentBytes))
					: chunk;
			const decoded = chunkToDecode.toString("utf8");
			emitLines(stream, decoded, false);
			if (stream === "stdout") {
				stdout += decoded;
				stdoutBytes += chunkToDecode.byteLength;
				stdoutTruncated = truncateOutputAtMaxBytes && nextBytes > maxOutputBytes;
			} else {
				stderr += decoded;
				stderrBytes += chunkToDecode.byteLength;
				stderrTruncated = truncateOutputAtMaxBytes && nextBytes > maxOutputBytes;
			}
		};

		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			fail(
				command === "git"
					? gitCommandError(options.operation, options.cwd, args, `${gitCommandLabel(args)} timed out.`)
					: new Error(`${commandLabel(command, args)} timed out.`),
			);
		}, timeoutMs);

		child.once("error", (error) => {
			if (error.message.includes("ENOENT")) {
				fail(new Error(`Command not found: ${command}`));
				return;
			}
			fail(error);
		});
		child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
		child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
		child.once("close", (code) => {
			emitLines("stdout", "", true);
			emitLines("stderr", "", true);
			finish({
				code: code ?? 1,
				stdout,
				stderr,
				stdoutTruncated,
				stderrTruncated,
			});
		});
		if (options.stdin !== undefined) {
			child.stdin.end(options.stdin);
		} else {
			child.stdin.end();
		}
	});
}

export function createDesktopAuxGitService(options: DesktopAuxGitOptions): DesktopAuxGitService {
	return new DesktopAuxGitService(options);
}
