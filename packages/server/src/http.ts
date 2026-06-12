import Mime from "@effect/platform-node/Mime";
import { Data, Effect, FileSystem, Option, Path } from "effect";
import { HttpRouter, HttpServerResponse, HttpServerRequest } from "effect/unstable/http";

import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachment-paths";
import { resolveAttachmentPathById } from "./attachment-store";
import { resolveStaticDir, ServerConfig } from "./config";
import { ProjectFaviconResolver } from "./project/ProjectFaviconResolver.service";
import { ServerAuth } from "./auth/ServerAuth.service.ts";
import { respondToAuthError } from "./auth/http.ts";
import { ServerEnvironment } from "./environment/ServerEnvironment.service.ts";

const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

export const browserApiCorsLayer = HttpRouter.cors({
  allowedMethods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["authorization", "content-type"],
  maxAge: 600,
});

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return LOOPBACK_HOSTNAMES.has(normalizedHostname);
}

export function resolveDevRedirectUrl(devUrl: URL, requestUrl: URL): string {
  const redirectUrl = new URL(devUrl.toString());
  redirectUrl.pathname = requestUrl.pathname;
  redirectUrl.search = requestUrl.search;
  redirectUrl.hash = requestUrl.hash;
  return redirectUrl.toString();
}

const requireAuthenticatedRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  yield* serverAuth.authenticateHttpRequest(request);
});

class AttachmentRequestUrlError extends Data.TaggedError("AttachmentRequestUrlError")<{}> {}

class AttachmentPathError extends Data.TaggedError("AttachmentPathError")<{}> {}

class AttachmentNotFoundError extends Data.TaggedError("AttachmentNotFoundError")<{}> {}

class AttachmentServeError extends Data.TaggedError("AttachmentServeError")<{
  readonly cause: unknown;
}> {}

type AttachmentRouteError =
  | AttachmentRequestUrlError
  | AttachmentPathError
  | AttachmentNotFoundError
  | AttachmentServeError;

function respondToAttachmentRouteError(error: AttachmentRouteError) {
  switch (error._tag) {
    case "AttachmentRequestUrlError":
      return Effect.succeed(HttpServerResponse.text("Bad Request", { status: 400 }));
    case "AttachmentPathError":
      return Effect.succeed(HttpServerResponse.text("Invalid attachment path", { status: 400 }));
    case "AttachmentNotFoundError":
      return Effect.succeed(HttpServerResponse.text("Not Found", { status: 404 }));
    case "AttachmentServeError":
      return Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 }));
  }
}

class ProjectFaviconRequestUrlError extends Data.TaggedError("ProjectFaviconRequestUrlError")<{}> {}

class ProjectFaviconMissingCwdError extends Data.TaggedError("ProjectFaviconMissingCwdError")<{}> {}

class ProjectFaviconServeError extends Data.TaggedError("ProjectFaviconServeError")<{
  readonly cause: unknown;
}> {}

type ProjectFaviconRouteError =
  | ProjectFaviconRequestUrlError
  | ProjectFaviconMissingCwdError
  | ProjectFaviconServeError;

function respondToProjectFaviconRouteError(error: ProjectFaviconRouteError) {
  switch (error._tag) {
    case "ProjectFaviconRequestUrlError":
      return Effect.succeed(HttpServerResponse.text("Bad Request", { status: 400 }));
    case "ProjectFaviconMissingCwdError":
      return Effect.succeed(HttpServerResponse.text("Missing cwd parameter", { status: 400 }));
    case "ProjectFaviconServeError":
      return Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 }));
  }
}

class StaticRequestUrlError extends Data.TaggedError("StaticRequestUrlError")<{}> {}

class StaticUnavailableError extends Data.TaggedError("StaticUnavailableError")<{}> {}

class StaticPathError extends Data.TaggedError("StaticPathError")<{}> {}

class StaticNotFoundError extends Data.TaggedError("StaticNotFoundError")<{}> {}

class StaticServeError extends Data.TaggedError("StaticServeError")<{
  readonly cause: unknown;
}> {}

type StaticRouteError =
  | StaticRequestUrlError
  | StaticUnavailableError
  | StaticPathError
  | StaticNotFoundError
  | StaticServeError;

function respondToStaticRouteError(error: StaticRouteError) {
  switch (error._tag) {
    case "StaticRequestUrlError":
      return Effect.succeed(HttpServerResponse.text("Bad Request", { status: 400 }));
    case "StaticUnavailableError":
      return Effect.succeed(
        HttpServerResponse.text("No static directory configured and no dev URL set.", {
          status: 503,
        }),
      );
    case "StaticPathError":
      return Effect.succeed(HttpServerResponse.text("Invalid static file path", { status: 400 }));
    case "StaticNotFoundError":
      return Effect.succeed(HttpServerResponse.text("Not Found", { status: 404 }));
    case "StaticServeError":
      return Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 }));
  }
}

export const serverEnvironmentRouteLayer = HttpRouter.add(
  "GET",
  "/.well-known/honk/environment",
  Effect.gen(function* () {
    const descriptor = yield* Effect.service(ServerEnvironment).pipe(
      Effect.flatMap((serverEnvironment) => serverEnvironment.getDescriptor),
    );
    return HttpServerResponse.jsonUnsafe(descriptor, { status: 200 });
  }),
);

export const attachmentsRouteLayer = HttpRouter.add(
  "GET",
  `${ATTACHMENTS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return yield* new AttachmentRequestUrlError();
    }

    const config = yield* ServerConfig;
    const rawRelativePath = url.value.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
    const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
    if (!normalizedRelativePath) {
      return yield* new AttachmentPathError();
    }

    const isIdLookup =
      !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
    const filePath = isIdLookup
      ? resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: normalizedRelativePath,
        })
      : resolveAttachmentRelativePath({
          attachmentsDir: config.attachmentsDir,
          relativePath: normalizedRelativePath,
        });
    if (!filePath) {
      return yield* isIdLookup ? new AttachmentNotFoundError() : new AttachmentPathError();
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return yield* new AttachmentNotFoundError();
    }

    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }).pipe(
      Effect.mapError(
        (cause) =>
          new AttachmentServeError({
            cause,
          }),
      ),
    );
  }).pipe(
    Effect.catchTag("AuthError", respondToAuthError),
    Effect.catchTags({
      AttachmentRequestUrlError: respondToAttachmentRouteError,
      AttachmentPathError: respondToAttachmentRouteError,
      AttachmentNotFoundError: respondToAttachmentRouteError,
      AttachmentServeError: respondToAttachmentRouteError,
    }),
  ),
);

export const projectFaviconRouteLayer = HttpRouter.add(
  "GET",
  "/api/project-favicon",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return yield* new ProjectFaviconRequestUrlError();
    }

    const projectCwd = url.value.searchParams.get("cwd");
    if (!projectCwd) {
      return yield* new ProjectFaviconMissingCwdError();
    }

    const faviconResolver = yield* ProjectFaviconResolver;
    const faviconFilePath = yield* faviconResolver.resolvePath(projectCwd);
    if (!faviconFilePath) {
      return HttpServerResponse.text(FALLBACK_PROJECT_FAVICON_SVG, {
        status: 200,
        contentType: "image/svg+xml",
        headers: {
          "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
        },
      });
    }

    return yield* HttpServerResponse.file(faviconFilePath, {
      status: 200,
      headers: {
        "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
      },
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectFaviconServeError({
            cause,
          }),
      ),
    );
  }).pipe(
    Effect.catchTag("AuthError", respondToAuthError),
    Effect.catchTags({
      ProjectFaviconRequestUrlError: respondToProjectFaviconRouteError,
      ProjectFaviconMissingCwdError: respondToProjectFaviconRouteError,
      ProjectFaviconServeError: respondToProjectFaviconRouteError,
    }),
  ),
);

export const staticAndDevRouteLayer = HttpRouter.add(
  "GET",
  "*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);

    if (Option.isNone(url)) {
      return yield* new StaticRequestUrlError();
    }

    const config = yield* ServerConfig;
    if (config.devUrl && isLoopbackHostname(url.value.hostname)) {
      return HttpServerResponse.redirect(resolveDevRedirectUrl(config.devUrl, url.value), {
        status: 302,
      });
    }

    const staticDir = config.staticDir ?? (config.devUrl ? yield* resolveStaticDir() : undefined);
    if (!staticDir) {
      return yield* new StaticUnavailableError();
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staticRoot = path.resolve(staticDir);
    const staticRequestPath = url.value.pathname === "/" ? "/index.html" : url.value.pathname;
    const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
    const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
    const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
    const hasPathTraversalSegment = staticRelativePath.startsWith("..");
    if (
      staticRelativePath.length === 0 ||
      hasRawLeadingParentSegment ||
      hasPathTraversalSegment ||
      staticRelativePath.includes("\0")
    ) {
      return yield* new StaticPathError();
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    let filePath = path.resolve(staticRoot, staticRelativePath);
    if (!isWithinStaticRoot(filePath)) {
      return yield* new StaticPathError();
    }

    const ext = path.extname(filePath);
    if (!ext) {
      filePath = path.resolve(filePath, "index.html");
      if (!isWithinStaticRoot(filePath)) {
        return yield* new StaticPathError();
      }
    }

    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      const indexPath = path.resolve(staticRoot, "index.html");
      const indexData = yield* fileSystem
        .readFile(indexPath)
        .pipe(Effect.mapError(() => new StaticNotFoundError()));
      return HttpServerResponse.uint8Array(indexData, {
        status: 200,
        contentType: "text/html; charset=utf-8",
      });
    }

    const contentType = Mime.getType(filePath) ?? "application/octet-stream";
    const data = yield* fileSystem
      .readFile(filePath)
      .pipe(Effect.mapError((cause) => new StaticServeError({ cause })));

    return HttpServerResponse.uint8Array(data, {
      status: 200,
      contentType,
    });
  }).pipe(
    Effect.catchTags({
      StaticRequestUrlError: respondToStaticRouteError,
      StaticUnavailableError: respondToStaticRouteError,
      StaticPathError: respondToStaticRouteError,
      StaticNotFoundError: respondToStaticRouteError,
      StaticServeError: respondToStaticRouteError,
    }),
  ),
);
