#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(packageRoot, "registry.json");
const componentsPath = path.join(packageRoot, "components.json");
const packageJsonPath = path.join(packageRoot, "package.json");

const registry = readJson(registryPath);
const components = readJson(componentsPath);
const packageJson = readJson(packageJsonPath);
const registryItems = registry.items ?? [];
const registryItemsByName = new Map(registryItems.map((item) => [item.name, item]));
const packageDependencies = packageJson.dependencies ?? {};
const errors = [];
const shadcnStyles = new Set(["default", "new-york"]);
const ignoredExternalImports = new Set(["react/jsx-runtime", "react/jsx-dev-runtime"]);
const ignoredExternalPackages = new Set(["react"]);

assertUnique(
  registryItems.map((item) => item.name),
  "registry item name",
);

if (components.registries?.["@honkkit"] !== "https://honk.app/r/{name}.json") {
  errors.push('components.json must map "@honkkit" to "https://honk.app/r/{name}.json".');
}

if (!shadcnStyles.has(components.style)) {
  errors.push('components.json style must be a shadcn built-in style: "default" or "new-york".');
}

for (const item of registryItems) {
  for (const dependency of item.dependencies ?? []) {
    validatePackageDependency(item.name, dependency);
  }

  for (const dependency of item.registryDependencies ?? []) {
    if (!dependency.startsWith("@honkkit/")) {
      errors.push(`${item.name} has unqualified registry dependency "${dependency}".`);
      continue;
    }

    const dependencyName = dependency.slice("@honkkit/".length);
    if (!registryItemsByName.has(dependencyName)) {
      errors.push(`${item.name} depends on missing registry item "${dependency}".`);
    }
  }

  for (const file of item.files ?? []) {
    const absoluteFilePath = path.resolve(packageRoot, file.path);
    if (!absoluteFilePath.startsWith(packageRoot + path.sep)) {
      errors.push(`${item.name} declares file outside package root: ${file.path}`);
      continue;
    }
    if (!fs.existsSync(absoluteFilePath)) {
      errors.push(`${item.name} declares missing file: ${file.path}`);
    }
    validateRegistryTarget(item.name, file);
  }
}

for (const item of registryItems) {
  const declaredFiles = collectRegistryFiles(item.name);
  const declaredTargets = collectRegistryTargets(item.name);
  const targetFiles = collectRegistryTargetFiles(item.name);
  const declaredPackages = collectRegistryPackages(item.name);
  const importedPackages = new Map();

  for (const [target, files] of targetFiles) {
    const [firstFile, ...otherFiles] = files;
    if (!firstFile) {
      continue;
    }

    for (const file of otherFiles) {
      if (file.content !== firstFile.content) {
        errors.push(
          `${item.name} install closure writes different content to ${target}: ${firstFile.path} and ${file.path}.`,
        );
      }
    }
  }

  for (const file of item.files ?? []) {
    const absoluteFilePath = path.resolve(packageRoot, file.path);
    if (!fs.existsSync(absoluteFilePath)) {
      continue;
    }

    const source = fs.readFileSync(absoluteFilePath, "utf8");
    for (const specifier of localImportSpecifiers(source)) {
      const resolved = resolveLocalImport(absoluteFilePath, specifier);
      if (!resolved || !resolved.startsWith(packageRoot + path.sep)) {
        continue;
      }
      if (!declaredFiles.has(resolved)) {
        errors.push(
          `${item.name} ${relativeToPackage(absoluteFilePath)} imports ${specifier} (${relativeToPackage(resolved)}) without declaring the file or a registry dependency that provides it.`,
        );
      }

      const resolvedTarget = resolveTargetImport(file.target, specifier, declaredTargets);
      if (!resolvedTarget || !declaredTargets.has(resolvedTarget)) {
        errors.push(
          `${item.name} ${file.target} keeps local import ${specifier}, but no declared registry target resolves that import after copy-out.`,
        );
      }
    }
  }

  for (const filePath of declaredFiles) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const source = fs.readFileSync(filePath, "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith(".") || ignoredExternalImports.has(specifier)) {
        continue;
      }
      const packageName = packageNameFromSpecifier(specifier);
      if (ignoredExternalPackages.has(packageName)) {
        continue;
      }
      if (!importedPackages.has(packageName)) {
        importedPackages.set(packageName, relativeToPackage(filePath));
      }
    }
  }

  for (const [packageName, filePath] of importedPackages) {
    if (!declaredPackages.has(packageName)) {
      errors.push(
        `${item.name} install closure imports "${packageName}" from ${filePath} without declaring it in dependencies.`,
      );
    }
  }
}

const registryNames = new Set(registryItems.map((item) => item.name));
const ignoredExports = new Set(["styles.css", "naming", "theme", "theme/tokens.stylex", "utils"]);
for (const exportKey of Object.keys(packageJson.exports ?? {})) {
  const subpath = exportKey.replace(/^\.\//, "");
  if (!ignoredExports.has(subpath) && !registryNames.has(subpath)) {
    errors.push(`package export "${exportKey}" has no registry item.`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`registry check: ${error}`);
  }
  process.exit(1);
}

console.log("honkkit registry ok");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      errors.push(`duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function collectRegistryFiles(itemName, seenItems = new Set()) {
  if (seenItems.has(itemName)) {
    return new Set();
  }
  seenItems.add(itemName);

  const item = registryItemsByName.get(itemName);
  const files = new Set();
  if (!item) {
    return files;
  }

  for (const file of item.files ?? []) {
    files.add(path.resolve(packageRoot, file.path));
  }

  for (const dependency of item.registryDependencies ?? []) {
    const dependencyName = dependency.startsWith("@honkkit/")
      ? dependency.slice("@honkkit/".length)
      : null;
    if (!dependencyName) {
      continue;
    }
    for (const file of collectRegistryFiles(dependencyName, seenItems)) {
      files.add(file);
    }
  }

  return files;
}

function collectRegistryTargets(itemName, seenItems = new Set()) {
  if (seenItems.has(itemName)) {
    return new Set();
  }
  seenItems.add(itemName);

  const item = registryItemsByName.get(itemName);
  const targets = new Set();
  if (!item) {
    return targets;
  }

  for (const file of item.files ?? []) {
    if (!file.target) {
      errors.push(`${item.name} ${file.path} has no registry target.`);
      continue;
    }
    targets.add(path.posix.normalize(file.target));
  }

  for (const dependency of item.registryDependencies ?? []) {
    const dependencyName = dependency.startsWith("@honkkit/")
      ? dependency.slice("@honkkit/".length)
      : null;
    if (!dependencyName) {
      continue;
    }
    for (const target of collectRegistryTargets(dependencyName, seenItems)) {
      targets.add(target);
    }
  }

  return targets;
}

function collectRegistryTargetFiles(itemName, seenItems = new Set()) {
  if (seenItems.has(itemName)) {
    return new Map();
  }
  seenItems.add(itemName);

  const item = registryItemsByName.get(itemName);
  const targetFiles = new Map();
  if (!item) {
    return targetFiles;
  }

  for (const file of item.files ?? []) {
    if (!file.target) {
      continue;
    }
    const absoluteFilePath = path.resolve(packageRoot, file.path);
    const files = targetFiles.get(file.target) ?? [];
    files.push({
      path: file.path,
      content: fs.existsSync(absoluteFilePath) ? fs.readFileSync(absoluteFilePath, "utf8") : "",
    });
    targetFiles.set(file.target, files);
  }

  for (const dependency of item.registryDependencies ?? []) {
    const dependencyName = dependency.startsWith("@honkkit/")
      ? dependency.slice("@honkkit/".length)
      : null;
    if (!dependencyName) {
      continue;
    }
    for (const [target, files] of collectRegistryTargetFiles(dependencyName, seenItems)) {
      targetFiles.set(target, [...(targetFiles.get(target) ?? []), ...files]);
    }
  }

  return targetFiles;
}

function collectRegistryPackages(itemName, seenItems = new Set()) {
  if (seenItems.has(itemName)) {
    return new Set();
  }
  seenItems.add(itemName);

  const item = registryItemsByName.get(itemName);
  const packages = new Set();
  if (!item) {
    return packages;
  }

  for (const dependency of item.dependencies ?? []) {
    packages.add(packageNameFromDependency(dependency));
  }

  for (const dependency of item.registryDependencies ?? []) {
    const dependencyName = dependency.startsWith("@honkkit/")
      ? dependency.slice("@honkkit/".length)
      : null;
    if (!dependencyName) {
      continue;
    }
    for (const packageName of collectRegistryPackages(dependencyName, seenItems)) {
      packages.add(packageName);
    }
  }

  return packages;
}

function* localImportSpecifiers(source) {
  const localImportPattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*from\s+)?["'](\.{1,2}\/[^"']+)["']/g;
  for (const match of source.matchAll(localImportPattern)) {
    yield match[1];
  }
}

function* importSpecifiers(source) {
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    yield match[1];
  }
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function packageNameFromDependency(dependency) {
  const aliasIndex = dependency.indexOf("@npm:");
  if (aliasIndex > 0) {
    return dependency.slice(0, aliasIndex);
  }

  if (dependency.startsWith("@")) {
    const [scope, nameAndVersion] = dependency.split("/");
    const versionIndex = nameAndVersion.indexOf("@");
    return `${scope}/${versionIndex === -1 ? nameAndVersion : nameAndVersion.slice(0, versionIndex)}`;
  }

  return dependency.split("@")[0];
}

function validatePackageDependency(itemName, dependency) {
  const packageName = packageNameFromDependency(dependency);
  const manifestDependency = packageDependencies[packageName];
  if (!manifestDependency) {
    errors.push(`${itemName} declares npm dependency "${dependency}" not found in package.json.`);
    return;
  }

  if (manifestDependency.startsWith("npm:")) {
    const expectedDependency = `${packageName}@${manifestDependency}`;
    if (dependency !== expectedDependency) {
      errors.push(
        `${itemName} declares aliased npm dependency "${dependency}", expected "${expectedDependency}".`,
      );
    }
  }
}

function resolveLocalImport(fromFile, specifier) {
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".css"];
  const candidates = [
    basePath,
    ...extensions.map((extension) => `${basePath}${extension}`),
    ...extensions.map((extension) => path.join(basePath, `index${extension}`)),
  ];

  return candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
}

function resolveTargetImport(fromTarget, specifier, declaredTargets) {
  if (!fromTarget) {
    return null;
  }

  const baseTarget = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromTarget), specifier),
  );
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".css"];
  const candidates = [
    baseTarget,
    ...extensions.map((extension) => `${baseTarget}${extension}`),
    ...extensions.map((extension) => path.join(baseTarget, `index${extension}`)),
  ];

  return candidates.find((candidate) => declaredTargets.has(path.posix.normalize(candidate)));
}

function validateRegistryTarget(itemName, file) {
  if (!file.target) {
    errors.push(`${itemName} ${file.path} has no registry target.`);
    return;
  }

  const targetParts = file.target.split("/");
  if (
    file.target.startsWith("/") ||
    file.target.includes("\\") ||
    targetParts.includes("..") ||
    file.target !== path.posix.normalize(file.target)
  ) {
    errors.push(`${itemName} ${file.path} has unsafe registry target: ${file.target}`);
  }

  const sourceExtension = path.extname(file.path);
  const targetExtension = path.extname(file.target);
  if (sourceExtension !== targetExtension) {
    errors.push(
      `${itemName} ${file.path} target ${file.target} changes extension from ${sourceExtension} to ${targetExtension}.`,
    );
  }
}

function relativeToPackage(filePath) {
  return path.relative(packageRoot, filePath);
}
