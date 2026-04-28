/**
 * Test script for the godot-gamedev template.
 *
 * Constructs a ResolvedInstance from the template and runs it through
 * all generators. Outputs the generated Dockerfile, docker-compose.yml,
 * docker-entrypoint.sh, and opencode.docker.json so we can verify they
 * are correct.
 *
 * Usage: bun run test/test-godot-template.ts
 */

import { godotGamedevTemplate } from "../src/templates/godot-gamedev.ts";
import { generateDockerfile } from "../src/generators/dockerfile.ts";
import { generateCompose } from "../src/generators/compose.ts";
import { generateEntrypoint } from "../src/generators/entrypoint.ts";
import { generateOpenCodeConfig } from "../src/generators/opencode-config.ts";
import { generateAgentsMd } from "../src/generators/agents-md.ts";
import type { ResolvedInstance, ContainerService, DockerConfig } from "../src/types.ts";

// ── Build a fake ResolvedInstance from the godot template ──────────────────

const template = godotGamedevTemplate;
const projectName = "my-godot-game";
const workspacePath = `/workspace/${projectName}`;
const hostPath = `/home/user/projects/${projectName}`;

// Namespace services (same as config/manager.ts does)
const containerServices: ContainerService[] = template.services.container.map(
  (svc) => ({
    ...svc,
    name: `${projectName}:${svc.name}`,
    workdir: svc.workdir ?? workspacePath,
    dependsOn: svc.dependsOn?.map((d) =>
      d.includes(":") ? d : `${projectName}:${d}`
    ),
  })
);

const docker: DockerConfig = {
  ...template.docker,
};

const resolved: ResolvedInstance = {
  name: "godot-test",
  projects: [
    {
      name: projectName,
      hostPath,
      isRemote: false,
      workspacePath,
      services: { container: containerServices, host: [] },
      envOverrides: { ...template.envOverrides },
    },
  ],
  docker,
  mcp: { ...template.mcp },
  allContainerServices: containerServices,
  allHostServices: [],
  envOverrides: { ...template.envOverrides },
  envSecrets: {
    GIT_AUTHOR_NAME: "Test User",
    GIT_COMMITTER_NAME: "Test User",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_EMAIL: "test@example.com",
    GH_TOKEN: "ghp_test123",
  },
  ports: [...template.ports],
  permission: template.permission,
  extraRepos: [],
};

// ── Generate all files ────────────────────────────────────────────────────

const dockerfile = generateDockerfile(resolved);
const compose = generateCompose(resolved);
const entrypoint = generateEntrypoint(resolved);
const opencodeConfig = generateOpenCodeConfig(resolved);
const agentsMd = generateAgentsMd(resolved);

// ── Validate and output ───────────────────────────────────────────────────

let errors = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
    errors++;
  }
}

console.log("=".repeat(72));
console.log("GODOT-GAMEDEV TEMPLATE — GENERATED OUTPUT VALIDATION");
console.log("=".repeat(72));

// ── Dockerfile checks ─────────────────────────────────────────────────────
console.log("\n── Dockerfile ──");
check(
  "Contains Godot download URL",
  dockerfile.includes("godotengine/godot/releases/download/4.6.1-stable")
);
check(
  "Installs Godot to /usr/local/bin/godot",
  dockerfile.includes("/usr/local/bin/godot")
);
check(
  "Includes xvfb in apt packages",
  dockerfile.includes("xvfb")
);
check(
  "Includes libgl1 in apt packages",
  dockerfile.includes("libgl1")
);
check(
  "Has Godot comment header",
  dockerfile.includes("# Godot Engine 4.6.1 (headless)")
);
check(
  "Does NOT install Chrome (installChrome=false)",
  !dockerfile.includes("google-chrome")
);
check(
  "Does NOT install Supabase CLI",
  !dockerfile.includes("supabase")
);
check(
  "Does install Bun",
  dockerfile.includes("bun.sh/install")
);

// ── Entrypoint checks ─────────────────────────────────────────────────────
console.log("\n── Entrypoint ──");
check(
  "Xvfb is listed as a daemon service",
  entrypoint.includes("[daemon] my-godot-game:xvfb")
);
check(
  "Xvfb start command is present",
  entrypoint.includes("Xvfb :99 -screen 0 1280x720x24 -nolisten tcp")
);
check(
  "Xvfb has DISPLAY=:99 env var",
  entrypoint.includes('DISPLAY=":99"') || entrypoint.includes("DISPLAY=\\\":99\\\"")
);
check(
  "Watchdog monitors daemons",
  entrypoint.includes("DAEMON_CMDS") && entrypoint.includes("restart_daemon")
);
check(
  "Xvfb restart policy is 'always'",
  entrypoint.includes('DAEMON_RESTART["my-godot-game:xvfb"]="always"')
);
check(
  "Watchdog DAEMON_CMDS includes env prefix for Xvfb",
  entrypoint.includes('DAEMON_CMDS["my-godot-game:xvfb"]="DISPLAY=')
);

// ── OpenCode config checks ────────────────────────────────────────────────
console.log("\n── opencode.docker.json ──");
const parsed = JSON.parse(opencodeConfig);
check(
  "Permission is 'allow'",
  parsed.permission === "allow"
);
check(
  "Has godot MCP server",
  parsed.mcp?.godot !== undefined
);
check(
  "Godot MCP type is 'local'",
  parsed.mcp?.godot?.type === "local"
);
check(
  "Godot MCP command uses npx @coding-solo/godot-mcp",
  Array.isArray(parsed.mcp?.godot?.command) &&
    parsed.mcp.godot.command.includes("@coding-solo/godot-mcp")
);
check(
  "Godot MCP has environment.GODOT_PATH",
  parsed.mcp?.godot?.environment?.GODOT_PATH === "/usr/local/bin/godot"
);
check(
  "Godot MCP has environment.DEBUG",
  parsed.mcp?.godot?.environment?.DEBUG === "true"
);

// ── Compose checks ────────────────────────────────────────────────────────
console.log("\n── docker-compose.yml ──");
check(
  "Mounts project directory",
  compose.includes(`${hostPath}:${workspacePath}`)
);
check(
  "Sets DISPLAY env override",
  compose.includes("DISPLAY=:99")
);
check(
  "Sets GODOT_PATH env override",
  compose.includes("GODOT_PATH=/usr/local/bin/godot")
);
check(
  "Does NOT have Chrome env vars",
  !compose.includes("CHROME_PATH")
);

// ── AGENTS.md checks ──────────────────────────────────────────────────────
console.log("\n── AGENTS.md ──");
check(
  "Contains instance name in header",
  agentsMd.includes("# Sandbox Environment — godot-test")
);
check(
  "Lists Godot in installed software table",
  agentsMd.includes("Godot Engine 4.6.1 (headless)")
);
check(
  "Has Godot description in Custom Software Details",
  agentsMd.includes("### Custom Software Details") &&
    agentsMd.includes("Godot 4.6.1 game engine installed at")
);
check(
  "Lists godot MCP server",
  agentsMd.includes("### `godot` (Local)")
);
check(
  "Lists Xvfb daemon service",
  agentsMd.includes("**my-godot-game:xvfb**")
);
check(
  "Lists DISPLAY environment variable",
  agentsMd.includes("`DISPLAY=:99`")
);
check(
  "Lists project path",
  agentsMd.includes(`\`${workspacePath}\``)
);
check(
  "Has bootstrapping section with godot CLI",
  agentsMd.includes("Bootstrapping New Projects") &&
    agentsMd.includes("`godot`")
);
check(
  "Permission is documented as allow",
  agentsMd.includes("permission level is `allow`")
);
check(
  "Bun is marked as installed",
  agentsMd.includes("| Bun | Yes |")
);
check(
  "Chrome is marked as not installed",
  agentsMd.includes("| Google Chrome | No |")
);
check(
  "Supabase CLI is marked as not installed",
  agentsMd.includes("| Supabase CLI | No |")
);
check(
  "Has networking section with host.docker.internal",
  agentsMd.includes("host.docker.internal")
);

// ── Summary ───────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(72));
if (errors === 0) {
  console.log("ALL CHECKS PASSED");
} else {
  console.log(`${errors} CHECK(S) FAILED`);
}
console.log("=".repeat(72));

// ── Print full generated files ────────────────────────────────────────────
console.log("\n\n" + "─".repeat(72));
console.log("GENERATED Dockerfile:");
console.log("─".repeat(72));
console.log(dockerfile);

console.log("─".repeat(72));
console.log("GENERATED docker-entrypoint.sh:");
console.log("─".repeat(72));
console.log(entrypoint);

console.log("─".repeat(72));
console.log("GENERATED opencode.docker.json:");
console.log("─".repeat(72));
console.log(opencodeConfig);

console.log("─".repeat(72));
console.log("GENERATED docker-compose.yml:");
console.log("─".repeat(72));
console.log(compose);

console.log("─".repeat(72));
console.log("GENERATED AGENTS.md:");
console.log("─".repeat(72));
console.log(agentsMd);

process.exit(errors > 0 ? 1 : 0);
