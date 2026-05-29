import { copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { safeFileSegment } from "./tools/artifacts.js";

export const DEFAULT_IMPLEMENTATION_ROOT = "implementations";
export const BUILD_MANIFEST_NAME = "BUILD_MANIFEST.json";

export interface BuildManifestFile {
  source: string;
  target: string;
  action?: "copy";
}

export interface BuildManifest {
  buildId: string;
  implementationPath?: string;
  files: BuildManifestFile[];
  validationCommands?: string[];
  notes?: string | string[];
}

export interface ApplyBuildResult {
  buildId: string;
  projectRoot: string;
  buildPath: string;
  manifestPath: string;
  dryRun: boolean;
  files: Array<{ source: string; target: string; action: "copy" }>;
}

export function getBuildRoot(cwd: string, implementationRoot = DEFAULT_IMPLEMENTATION_ROOT): string {
  const normalized = normalizeRelativePath(implementationRoot, "Implementation root");
  const resolved = resolve(cwd, normalized);
  assertInside(cwd, resolved, "Implementation root");
  return resolved;
}

export function getBuildPath(cwd: string, buildId: string, implementationRoot = DEFAULT_IMPLEMENTATION_ROOT): string {
  const safeBuildId = safeFileSegment(buildId);
  const root = getBuildRoot(cwd, implementationRoot);
  const resolved = resolve(root, safeBuildId);
  assertInside(root, resolved, "Build path");
  return resolved;
}

export function getManifestPath(cwd: string, buildId: string, implementationRoot = DEFAULT_IMPLEMENTATION_ROOT): string {
  return resolve(getBuildPath(cwd, buildId, implementationRoot), BUILD_MANIFEST_NAME);
}

export function chooseBuildId(cwd: string, proposed: string, implementationRoot = DEFAULT_IMPLEMENTATION_ROOT): string {
  const base = safeFileSegment(proposed).slice(0, 64) || "implementation";
  for (let index = 0; index < 100; index++) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    if (!existsSync(getBuildPath(cwd, candidate, implementationRoot))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function readBuildManifest(
  cwd: string,
  buildId: string,
  implementationRoot = DEFAULT_IMPLEMENTATION_ROOT
): Promise<BuildManifest> {
  const manifestPath = getManifestPath(cwd, buildId, implementationRoot);
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<BuildManifest>;
  if (!parsed || typeof parsed !== "object") throw new Error("Build manifest must be a JSON object.");
  if (parsed.buildId !== safeFileSegment(buildId)) {
    throw new Error(`Build manifest buildId must be ${safeFileSegment(buildId)}.`);
  }
  if (!Array.isArray(parsed.files)) throw new Error("Build manifest must include a files array.");
  return {
    buildId: parsed.buildId,
    implementationPath: parsed.implementationPath,
    files: parsed.files,
    validationCommands: Array.isArray(parsed.validationCommands) ? parsed.validationCommands : [],
    notes: parsed.notes
  };
}

export async function applyBuildManifest(
  cwd: string,
  buildId: string,
  options: { dryRun?: boolean; implementationRoot?: string } = {}
): Promise<ApplyBuildResult> {
  const implementationRoot = options.implementationRoot ?? DEFAULT_IMPLEMENTATION_ROOT;
  const safeBuildId = safeFileSegment(buildId);
  const buildPath = getBuildPath(cwd, safeBuildId, implementationRoot);
  const manifestPath = getManifestPath(cwd, safeBuildId, implementationRoot);
  const manifest = await readBuildManifest(cwd, safeBuildId, implementationRoot);
  const files = manifest.files.map((file) => resolveManifestFile(cwd, buildPath, file));

  if (!options.dryRun) {
    for (const file of files) {
      await mkdir(dirname(file.target), { recursive: true });
      await copyFile(file.source, file.target);
    }
  }

  return { buildId: safeBuildId, projectRoot: cwd, buildPath: relative(cwd, buildPath), manifestPath: relative(cwd, manifestPath), dryRun: Boolean(options.dryRun), files };
}

export function formatApplyBuildResult(result: ApplyBuildResult): string {
  const heading = result.dryRun ? "Build merge dry run" : "Build merged";
  return [
    `${heading}: ${result.buildId}`,
    `Implementation: ${result.buildPath}`,
    `Manifest: ${result.manifestPath}`,
    "",
    result.files.length ? "Files:" : "Files: (none)",
    ...result.files.map((file) => `- ${relative(result.projectRoot, file.source)} -> ${relative(result.projectRoot, file.target)}`),
    "",
    result.dryRun ? `Run \`/conject-apply-build ${result.buildId} --yes\` to copy these files into the project root.` : "Done."
  ].join("\n");
}

export function defaultBuildIdFromProposal(content: string): string {
  const heading = /^#\s+(.+)$/m.exec(content)?.[1] ?? "implementation";
  return safeFileSegment(heading);
}

function resolveManifestFile(cwd: string, buildPath: string, file: BuildManifestFile): { source: string; target: string; action: "copy" } {
  if (!file || typeof file !== "object") throw new Error("Build manifest file entries must be objects.");
  if (file.action && file.action !== "copy") throw new Error(`Unsupported build manifest action: ${file.action}`);
  if (typeof file.source !== "string") throw new Error("Build manifest file source must be a string.");
  if (typeof file.target !== "string") throw new Error("Build manifest file target must be a string.");
  const sourceRelative = normalizeRelativePath(file.source, "Build manifest source");
  const targetRelative = normalizeRelativePath(file.target, "Build manifest target");
  rejectGeneratedPath(sourceRelative, "Build manifest source");
  rejectGeneratedPath(targetRelative, "Build manifest target");

  const source = resolve(buildPath, sourceRelative);
  const target = resolve(cwd, targetRelative);
  assertInside(buildPath, source, "Build manifest source");
  assertInside(cwd, target, "Build manifest target");
  if (!existsSync(source)) throw new Error(`Build manifest source does not exist: ${sourceRelative}`);
  return { source, target, action: "copy" };
}

function normalizeRelativePath(path: string, label: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (isAbsolute(path)) throw new Error(`${label} must be relative.`);
  if (normalized.split("/").some((part) => part === "..")) throw new Error(`${label} must not contain '..'.`);
  return normalized;
}

function rejectGeneratedPath(path: string, label: string): void {
  const parts = path.split("/");
  if (parts.includes(".venv")) throw new Error(`${label} must not include .venv.`);
  if (parts.includes("__pycache__")) throw new Error(`${label} must not include __pycache__.`);
  if (parts.includes("node_modules")) throw new Error(`${label} must not include node_modules.`);
  if (parts.includes(".conject")) throw new Error(`${label} must not include .conject.`);
  if (parts.includes("implementations")) throw new Error(`${label} must not include implementations.`);
}

function assertInside(root: string, candidate: string, label: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`${label} must stay inside ${resolvedRoot}.`);
  }
}
