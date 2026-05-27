export type SlashCommand =
  | { type: "help" }
  | { type: "login" }
  | { type: "logout" }
  | { type: "status" }
  | { type: "new"; prompt: string }
  | { type: "run" }
  | { type: "export" }
  | { type: "implement"; hypothesisId: string };

export function parseSlashCommand(input: string): SlashCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) throw new Error("Slash commands must start with /.");
  const [command = "", ...args] = splitArgs(trimmed.slice(1));

  if (command === "" || command === "help" || command === "?") return { type: "help" };
  if (command === "login") return noArgs(command, args, { type: "login" });
  if (command === "logout") return noArgs(command, args, { type: "logout" });
  if (command === "status") return noArgs(command, args, { type: "status" });
  if (command === "export") return noArgs(command, args, { type: "export" });

  if (command === "new") {
    const prompt = trimmed.slice(trimmed.indexOf("new") + "new".length).trim();
    if (!prompt) throw new Error("Usage: /new <prompt>");
    return { type: "new", prompt };
  }

  if (command === "run") {
    assertPiOnlyRuntime(command, args);
    return { type: "run" };
  }

  if (command === "implement") {
    if (args.length === 0) throw new Error("Usage: /implement <hypothesis-id>");
    const [hypothesisId, ...rest] = args;
    assertPiOnlyRuntime(command, rest);
    return { type: "implement", hypothesisId };
  }

  throw new Error(`Unknown command: /${command}. Use /help.`);
}

export function assertPiOnlyRuntime(command: string, args: string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--runtime") {
      const value = args[index + 1];
      if (value === "pi") {
        index += 1;
        continue;
      }
      throw new Error(`/${command} always uses Pi. Remove --runtime${value ? ` ${value}` : ""}.`);
    }
    if (arg.startsWith("--runtime=")) {
      const value = arg.slice("--runtime=".length);
      if (value === "pi") continue;
      throw new Error(`/${command} always uses Pi. Remove --runtime=${value}.`);
    }
    throw new Error(`Unknown option for /${command}: ${arg}`);
  }
}

function noArgs<T extends SlashCommand>(command: string, args: string[], result: T): T {
  if (args.length > 0) throw new Error(`/${command} does not take arguments.`);
  return result;
}

function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;

  for (const char of input) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote) throw new Error("Unclosed quote in slash command.");
  if (current) args.push(current);
  return args;
}
