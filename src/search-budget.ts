export const WEB_SEARCH_BUDGET_ENV = "CONJECT_WEB_SEARCH_BUDGET";
export const RESEARCHER_WEB_SEARCH_BUDGET_ENV = "CONJECT_RESEARCHER_WEB_SEARCH_BUDGET";
export const DEFAULT_RESEARCHER_WEB_SEARCH_BUDGET = 5;

export function parseNonNegativeIntegerBudget(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number.parseInt(trimmed, 10);
}

export function resolveResearcherWebSearchBudget(env: NodeJS.ProcessEnv = process.env): number {
  return parseNonNegativeIntegerBudget(env[RESEARCHER_WEB_SEARCH_BUDGET_ENV]) ?? DEFAULT_RESEARCHER_WEB_SEARCH_BUDGET;
}

export function formatResearcherWebSearchBudget(env: NodeJS.ProcessEnv = process.env): string {
  const configured = parseNonNegativeIntegerBudget(env[RESEARCHER_WEB_SEARCH_BUDGET_ENV]);
  return configured === undefined ? `${DEFAULT_RESEARCHER_WEB_SEARCH_BUDGET} (default)` : String(configured);
}
