import { Schema } from "effect";

import { PortSchema } from "./base-schemas";

export const DesktopBackendBootstrap = Schema.Struct({
  mode: Schema.Literal("desktop"),
  noBrowser: Schema.Boolean,
  port: PortSchema,
  multiHome: Schema.String,
  host: Schema.String,
  desktopBootstrapToken: Schema.String,
  runId: Schema.String,
  otlpTracesUrl: Schema.optional(Schema.String),
  otlpMetricsUrl: Schema.optional(Schema.String),
});

export type DesktopBackendBootstrap = typeof DesktopBackendBootstrap.Type;
