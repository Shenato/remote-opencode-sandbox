import type { ResolvedInstance } from "../types.ts";

/**
 * Generate the opencode.docker.json config for the container.
 *
 * This is loaded via OPENCODE_CONFIG env var inside the container.
 * It merges with whatever project-level opencode.jsonc exists.
 */
export function generateOpenCodeConfig(instance: ResolvedInstance): string {
  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    permission: instance.permission,
    mcp: instance.mcp,
  };

  return JSON.stringify(config, null, 2) + "\n";
}
