import { ModelSelection, ProjectId, ProjectScript } from "@honk/contracts";
import { Schema, Struct } from "effect";

import { ProjectionProject } from "../persistence/ProjectionProjects.service.ts";

export const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
  }),
);

export const ProjectRootLookupInput = Schema.Struct({
  projectRoot: Schema.String,
});

export const ProjectIdLookupInput = Schema.Struct({
  projectId: ProjectId,
});

export const ProjectionProjectLookupRowSchema = ProjectionProjectDbRowSchema;
