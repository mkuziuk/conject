export type ToolPermission = {
  network: "none" | "allowlist" | "open";
  filesystem: "none" | "read" | "write_run_dir" | "write_workspace";
  shell: "none" | "sandboxed";
};

export type ToolDefinition = {
  id: string;
  description: string;
  permission: ToolPermission;
  execute: (input: unknown) => Promise<unknown>;
};

export function createStubTool(id: string, description: string): ToolDefinition {
  return {
    id,
    description,
    permission: { network: "none", filesystem: "none", shell: "none" },
    async execute() {
      throw new Error(`Tool is not implemented yet: ${id}`);
    }
  };
}
