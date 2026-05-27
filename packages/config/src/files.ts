import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { ConjectConfigSchema, configForPreset, defaultConfig, type ConjectConfig } from "./schema.js";

export const CONFIG_FILE = "conject.yaml";

export function configPath(cwd: string): string {
  return join(cwd, CONFIG_FILE);
}

export function hasConfig(cwd: string): boolean {
  return existsSync(configPath(cwd));
}

export function loadConfig(cwd: string): ConjectConfig {
  const path = configPath(cwd);
  if (!existsSync(path)) {
    throw new Error(`Missing ${CONFIG_FILE}. Run 'conject init' first.`);
  }
  const parsed = YAML.parse(readFileSync(path, "utf8"));
  return ConjectConfigSchema.parse(parsed);
}

export function writeDefaultConfig(cwd: string, preset: "quick" | "balanced" | "deep" = "balanced"): string {
  const path = configPath(cwd);
  const config = configForPreset(preset);
  writeFileSync(path, renderConfig(config), "utf8");
  return path;
}

export function renderConfig(config: ConjectConfig = defaultConfig): string {
  const serializable = JSON.parse(JSON.stringify(config)) as ConjectConfig;
  const doc = new YAML.Document(serializable);
  return [
    "# Conject project configuration.",
    "# Commit this file. Keep credentials in environment variables referenced below.",
    "# Pi runtime state is Conject-owned and must stay under .conject/.",
    "# Use research.preset as the plain-language starting point, then edit numeric limits as needed.",
    doc.toString({ lineWidth: 100 })
  ].join("\n");
}
