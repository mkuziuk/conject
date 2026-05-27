import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import type { PiOAuthLoginCallbacks } from "@conject/runtime";

export function createOAuthLoginCallbacks(options: { manual: boolean }): PiOAuthLoginCallbacks & { close: () => void } {
  if (!options.manual) {
    return {
      onAuth: (info) => {
        console.log(info.instructions ?? "Complete Conject auth in your browser.");
        console.log(info.url);
        console.log("Waiting for browser callback. If it does not complete, rerun with: pnpm cli auth login --manual");
        openBrowser(info.url);
      },
      onDeviceCode: (info) => {
        console.log(`Open ${info.verificationUri} and enter code ${info.userCode}.`);
      },
      onPrompt: async () => {
        throw new Error("Browser OAuth callback did not complete. Rerun with: pnpm cli auth login --manual");
      },
      onProgress: (message) => console.log(message),
      onSelect: async () => undefined,
      close: () => undefined
    };
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (message: string): Promise<string> => {
    if (!process.stdin.isTTY) throw new Error("Conject auth manual code entry requires an interactive terminal.");
    return rl.question(`${message} `);
  };

  const callbacks: PiOAuthLoginCallbacks & { close: () => void } = {
    onAuth: (info) => {
      console.log(info.instructions ?? "Complete Conject auth in your browser.");
      console.log(info.url);
      openBrowser(info.url);
    },
    onDeviceCode: (info) => {
      console.log(`Open ${info.verificationUri} and enter code ${info.userCode}.`);
    },
    onPrompt: (prompt) => ask(prompt.message),
    onProgress: (message) => console.log(message),
    onSelect: async (prompt) => {
      console.log(prompt.message);
      for (const option of prompt.options) console.log(`${option.id}: ${option.label}`);
      const selected = await ask("Select option id:");
      return selected.trim() || undefined;
    },
    close: () => rl.close()
  };
  callbacks.onManualCodeInput = () => ask("Paste the authorization code or full redirect URL, or complete login in the browser:");
  return callbacks;
}

export function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : process.env.DISPLAY ? "xdg-open" : undefined;
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  if (!command) return;
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Printing the URL above is the reliable fallback.
  }
}
