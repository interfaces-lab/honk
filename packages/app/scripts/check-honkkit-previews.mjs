#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "../..");
const registryPath = path.join(repoRoot, "packages/honkkit/registry.json");
const previewsPath = path.join(appRoot, "src/components/dev/honkkit/previews.tsx");
const catalogPath = path.join(appRoot, "src/components/dev/honkkit/catalog.ts");

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const registryUiIds = new Set(
  (registry.items ?? []).filter((item) => item.type === "registry:ui").map((item) => item.name),
);
const previewModel = readPreviewModel();
const catalogModel = readCatalogModel();
const previewIds = previewModel.ids;
const catalogIds = catalogModel.componentIds;
const specialIds = catalogModel.specialIds;
const allowedPreviewIds = new Set([...registryUiIds, ...specialIds]);
const errors = [];

for (const id of previewModel.duplicates) {
  errors.push(`Duplicate HonkKit preview key "${id}".`);
}

for (const id of catalogModel.duplicateComponentIds) {
  errors.push(`Duplicate HonkKit catalog component id "${id}".`);
}

for (const id of catalogModel.duplicateSpecialIds) {
  errors.push(`Duplicate HonkKit special component id "${id}".`);
}

for (const id of registryUiIds) {
  if (!previewIds.has(id)) {
    errors.push(`Missing HonkKit preview for registry item "${id}".`);
  }
  if (!catalogIds.has(id)) {
    errors.push(`Missing HonkKit catalog entry for registry item "${id}".`);
  }
}

for (const id of specialIds) {
  if (!previewIds.has(id)) {
    errors.push(`Missing HonkKit preview for special catalog page "${id}".`);
  }
  if (!catalogIds.has(id)) {
    errors.push(`Missing HonkKit catalog entry for special page "${id}".`);
  }
}

for (const id of previewIds) {
  if (!allowedPreviewIds.has(id)) {
    errors.push(`HonkKit preview "${id}" is not backed by a registry item or special catalog page.`);
  }
}

for (const id of catalogIds) {
  if (!registryUiIds.has(id) && !specialIds.has(id)) {
    errors.push(`HonkKit catalog entry "${id}" is not backed by a registry item or special page.`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`honkkit preview check: ${error}`);
  }
  process.exit(1);
}

const registryCatalogEntryCount = [...catalogIds].filter((id) => registryUiIds.has(id)).length;

console.log(
  `honkkit previews ok (${previewIds.size} previews, ${registryCatalogEntryCount} registry catalog entries, ${specialIds.size} special pages)`,
);

function readPreviewModel() {
  const sourceText = fs.readFileSync(previewsPath, "utf8");
  const sourceFile = ts.createSourceFile(previewsPath, sourceText, ts.ScriptTarget.Latest, true);
  const previewInitializer = findMultiKitPreviewsInitializer(sourceFile);
  if (!previewInitializer) {
    throw new Error("Could not find MULTIKIT_PREVIEWS object literal.");
  }

  const ids = new Set();
  const duplicates = new Set();
  for (const property of previewInitializer.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const name = property.name;
    if (ts.isStringLiteral(name) || ts.isIdentifier(name)) {
      if (ids.has(name.text)) {
        duplicates.add(name.text);
      }
      ids.add(name.text);
    }
  }
  return { ids, duplicates };
}

function readCatalogModel() {
  const sourceText = fs.readFileSync(catalogPath, "utf8");
  const sourceFile = ts.createSourceFile(catalogPath, sourceText, ts.ScriptTarget.Latest, true);
  const categoryDefsInitializer = findVariableInitializer(
    sourceFile,
    "categoryDefs",
    ts.isArrayLiteralExpression,
  );
  const specialComponentsInitializer = findSpecialComponentsInitializer(sourceFile);

  if (!categoryDefsInitializer) {
    throw new Error("Could not find categoryDefs array literal.");
  }
  if (!specialComponentsInitializer) {
    throw new Error("Could not find specialComponents Map entries.");
  }

  const componentIds = new Set();
  const duplicateComponentIds = new Set();
  for (const category of categoryDefsInitializer.elements) {
    if (!ts.isObjectLiteralExpression(category)) {
      continue;
    }

    const componentIdsProperty = category.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        ((ts.isIdentifier(property.name) && property.name.text === "componentIds") ||
          (ts.isStringLiteral(property.name) && property.name.text === "componentIds")),
    );
    if (!componentIdsProperty || !ts.isPropertyAssignment(componentIdsProperty)) {
      continue;
    }
    if (!ts.isArrayLiteralExpression(componentIdsProperty.initializer)) {
      throw new Error("categoryDefs componentIds must be an array literal.");
    }

    for (const element of componentIdsProperty.initializer.elements) {
      if (!ts.isStringLiteral(element)) {
        throw new Error("categoryDefs componentIds must contain string literals.");
      }
      if (componentIds.has(element.text)) {
        duplicateComponentIds.add(element.text);
      }
      componentIds.add(element.text);
    }
  }

  const specialIds = new Set();
  const duplicateSpecialIds = new Set();
  for (const entry of specialComponentsInitializer.elements) {
    if (!ts.isArrayLiteralExpression(entry)) {
      continue;
    }

    const id = entry.elements[0];
    if (!id || !ts.isStringLiteral(id)) {
      throw new Error("specialComponents entries must start with a string literal id.");
    }
    if (specialIds.has(id.text)) {
      duplicateSpecialIds.add(id.text);
    }
    specialIds.add(id.text);
  }

  return {
    componentIds,
    duplicateComponentIds,
    duplicateSpecialIds,
    specialIds,
  };
}

function findMultiKitPreviewsInitializer(sourceFile) {
  return findVariableInitializer(sourceFile, "MULTIKIT_PREVIEWS", ts.isObjectLiteralExpression);
}

function findSpecialComponentsInitializer(sourceFile) {
  const initializer = findVariableInitializer(sourceFile, "specialComponents", ts.isNewExpression);
  const entries = initializer?.arguments?.[0];
  return entries && ts.isArrayLiteralExpression(entries) ? entries : null;
}

function findVariableInitializer(sourceFile, name, isExpectedInitializer) {
  let initializer = null;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      isExpectedInitializer(node.initializer)
    ) {
      initializer = node.initializer;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return initializer;
}
