import { randomBytes } from "node:crypto";

const counters = new Map<string, number>();

export function createId(prefix: string): string {
  const hex = randomBytes(16).toString("hex");
  return `${prefix}_${hex}`;
}

export function createReadableId(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(3, "0")}`;
}

export function createDeterministicReadableId(prefix: string): string {
  const next = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, next);
  return createReadableId(prefix, next);
}

export function resetReadableIdCounters(): void {
  counters.clear();
}
