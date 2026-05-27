import { describe, expect, it } from "vitest";
import { parseSlashCommand } from "../apps/cli/src/slash-commands.js";

describe("slash commands", () => {
  it("parses core TUI commands", () => {
    expect(parseSlashCommand("/login")).toEqual({ type: "login" });
    expect(parseSlashCommand("/status")).toEqual({ type: "status" });
    expect(parseSlashCommand("/new robust hyperspectral unmixing")).toEqual({
      type: "new",
      prompt: "robust hyperspectral unmixing"
    });
    expect(parseSlashCommand("/run")).toEqual({ type: "run" });
    expect(parseSlashCommand("/run --runtime pi")).toEqual({ type: "run" });
    expect(parseSlashCommand("/export")).toEqual({ type: "export" });
    expect(parseSlashCommand("/implement HYP-001")).toEqual({ type: "implement", hypothesisId: "HYP-001" });
    expect(parseSlashCommand("/implement HYP-001 --runtime pi")).toEqual({ type: "implement", hypothesisId: "HYP-001" });
  });

  it("rejects non-Pi runtime options", () => {
    expect(() => parseSlashCommand("/run --runtime mock")).toThrow("/run always uses Pi");
    expect(() => parseSlashCommand("/implement HYP-001 --runtime scaffold")).toThrow("/implement always uses Pi");
  });

  it("validates required arguments", () => {
    expect(() => parseSlashCommand("/new")).toThrow("Usage: /new <prompt>");
    expect(() => parseSlashCommand("/implement")).toThrow("Usage: /implement <hypothesis-id>");
    expect(() => parseSlashCommand("/unknown")).toThrow("Unknown command");
  });
});
