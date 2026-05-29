import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { inspectCredentialStore, resolveWebSearchStatus } from "./credentials.js";
import { resolveConjectEnvironment } from "./env.js";
import { getConjectExtensionPath, getConjectSkillsPath, getPackageRoot } from "./paths.js";

export interface DoctorInfo {
  packageName: string;
  packageVersion: string;
  piVersion: string;
  agentDir: string;
  sessionDir: string;
  skipVersionCheck: string;
  extensionPath: string;
  skillsPath: string;
  credentialPath: string;
  credentialsExist: boolean;
  credentialPermissionsOk: boolean;
  skills: string[];
  tools: string[];
  webSearch: "tavily" | "searxng" | "none";
}

export function getDoctorInfo(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env, home?: string): DoctorInfo {
  const configured = resolveConjectEnvironment({ cwd, env, home });
  const credentials = inspectCredentialStore({ home });
  const pkg = JSON.parse(readFileSync(join(getPackageRoot(), "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };

  return {
    packageName: pkg.name ?? "conject",
    packageVersion: pkg.version ?? "0.0.0",
    piVersion: PI_VERSION,
    agentDir: configured.agentDir,
    sessionDir: configured.sessionDir,
    skipVersionCheck: configured.skipVersionCheck,
    extensionPath: getConjectExtensionPath(),
    skillsPath: getConjectSkillsPath(),
    credentialPath: credentials.path,
    credentialsExist: credentials.exists,
    credentialPermissionsOk: credentials.permissionsOk,
    skills: listSkillNames(getConjectSkillsPath()),
    tools: [
      "conject_paper_search",
      "conject_web_search",
      "conject_extract_pdf",
      "conject_write_artifact",
      "conject_present_proposal",
      "conject_spawn_researcher",
      "conject_spawn_reviewer"
    ],
    webSearch: resolveWebSearchStatus(env)
  };
}

export function formatDoctorInfo(info: DoctorInfo): string {
  return [
    `Conject package: ${info.packageName}@${info.packageVersion}`,
    `Embedded Pi: @earendil-works/pi-coding-agent@${info.piVersion}`,
    `Agent dir: ${info.agentDir}`,
    `Session dir: ${info.sessionDir}`,
    `PI_SKIP_VERSION_CHECK: ${info.skipVersionCheck}`,
    `Extension: ${info.extensionPath}`,
    `Skills: ${info.skillsPath}`,
    `Credentials: ${info.credentialPath}`,
    `Credentials exist: ${info.credentialsExist ? "yes" : "no"}`,
    `Credential permissions: ${info.credentialPermissionsOk ? "ok" : "check"}`,
    `Web search: ${info.webSearch}`,
    "",
    "Loaded Conject skills:",
    ...info.skills.map((skill) => `- ${skill}`),
    "",
    "Registered Conject tools:",
    ...info.tools.map((tool) => `- ${tool}`)
  ].join("\n");
}

function listSkillNames(skillsPath: string): string[] {
  if (!existsSync(skillsPath)) return [];
  return readdirSync(skillsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
