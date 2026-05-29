import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { getConjectSkillLocations, listConjectSkills, type ConjectSkillListEntry } from "./custom-skills.js";
import { inspectCredentialStore, resolveWebSearchStatus } from "./credentials.js";
import { resolveConjectEnvironment } from "./env.js";
import { getConjectExtensionPath, getConjectSkillsPath, getConjectSubagentsPath, getPackageRoot } from "./paths.js";
import { formatResearcherWebSearchBudget } from "./search-budget.js";
import { inspectModelAuthStore } from "./setup.js";
import { loadSubagentPrompt, SUBAGENT_PROMPT_NAMES, type SubagentPromptName } from "./subagent-prompts.js";

export interface SubagentPromptStatus {
  name: SubagentPromptName;
  path: string;
  ok: boolean;
  error?: string;
}

export interface DoctorInfo {
  packageName: string;
  packageVersion: string;
  piVersion: string;
  agentDir: string;
  sessionDir: string;
  skipVersionCheck: string;
  extensionPath: string;
  skillsPath: string;
  customSkillPaths: Array<{ label: string; path: string }>;
  customSkills: Array<Pick<ConjectSkillListEntry, "name" | "scope">>;
  subagentPrompts: SubagentPromptStatus[];
  credentialPath: string;
  credentialsExist: boolean;
  credentialPermissionsOk: boolean;
  modelAuthPath: string;
  modelAuthProviders: string[];
  skills: string[];
  tools: string[];
  webSearch: "tavily" | "searxng" | "none";
  researcherWebSearchBudget: string;
}

export function getDoctorInfo(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env, home?: string): DoctorInfo {
  const configured = resolveConjectEnvironment({ cwd, env, home });
  const credentials = inspectCredentialStore({ home });
  const modelAuth = inspectModelAuthStore(home);
  const skillLocations = getConjectSkillLocations({ cwd, home });
  const customSkillList = listConjectSkills({ cwd, home }).skills.filter((skill) => skill.scope !== "bundled");
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
    customSkillPaths: skillLocations
      .filter((location) => location.scope !== "bundled")
      .map((location) => ({ label: location.label, path: location.path })),
    customSkills: customSkillList.map((skill) => ({ name: skill.name, scope: skill.scope })),
    subagentPrompts: inspectSubagentPrompts(),
    credentialPath: credentials.path,
    credentialsExist: credentials.exists,
    credentialPermissionsOk: credentials.permissionsOk,
    modelAuthPath: modelAuth.path,
    modelAuthProviders: modelAuth.providers.map((provider) => `${provider.provider} (${provider.type})`),
    skills: listSkillNames(getConjectSkillsPath()),
    tools: [
      "conject_paper_search",
      "conject_web_search",
      "conject_extract_pdf",
      "conject_write_artifact",
      "conject_present_proposal",
      "conject_spawn_researcher",
      "conject_spawn_reviewer",
      "conject_spawn_builder"
    ],
    webSearch: resolveWebSearchStatus(env),
    researcherWebSearchBudget: formatResearcherWebSearchBudget(env)
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
    "Custom skill paths:",
    ...info.customSkillPaths.map((location) => `- ${location.label}: ${location.path}`),
    `Credentials: ${info.credentialPath}`,
    `Credentials exist: ${info.credentialsExist ? "yes" : "no"}`,
    `Credential permissions: ${info.credentialPermissionsOk ? "ok" : "check"}`,
    `Model auth: ${info.modelAuthPath}`,
    `Model providers: ${info.modelAuthProviders.length ? info.modelAuthProviders.join(", ") : "none"}`,
    `Web search: ${info.webSearch}`,
    `Researcher web search budget: ${info.researcherWebSearchBudget}`,
    `Setup: run conject setup for guided provider and tool credential setup`,
    "",
    "Loaded Conject skills:",
    ...info.skills.map((skill) => `- ${skill}`),
    "",
    "Custom skills:",
    ...(info.customSkills.length ? info.customSkills.map((skill) => `- [${skill.scope}] ${skill.name}`) : ["- none"]),
    "",
    "Subagent prompts:",
    ...info.subagentPrompts.map(formatSubagentPromptStatus),
    "",
    "Registered Conject tools:",
    ...info.tools.map((tool) => `- ${tool}`)
  ].join("\n");
}

function inspectSubagentPrompts(): SubagentPromptStatus[] {
  return SUBAGENT_PROMPT_NAMES.map((name) => {
    try {
      const prompt = loadSubagentPrompt(name);
      return { name, path: prompt.path, ok: true };
    } catch (error) {
      return {
        name,
        path: join(getConjectSubagentsPath(), `${name}.md`),
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}

function formatSubagentPromptStatus(status: SubagentPromptStatus): string {
  if (status.ok) return `- ${status.name}: ok (${status.path})`;
  return `- ${status.name}: failed (${status.path}) ${status.error ?? ""}`.trimEnd();
}

function listSkillNames(skillsPath: string): string[] {
  if (!existsSync(skillsPath)) return [];
  return readdirSync(skillsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
