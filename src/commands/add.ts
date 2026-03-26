import fs from "node:fs";
import path from "node:path";
import { input, select, confirm, password, checkbox } from "@inquirer/prompts";
import chalk from "chalk";
import type {
  ProjectConfig,
  ContainerService,
  HostService,
  ProjectSandboxFile,
} from "../types.ts";
import {
  isInitialized,
  loadGlobalConfig,
  loadInstanceConfig,
  saveInstanceConfig,
  saveProjectConfig,
  loadProjectSandboxFile,
  instanceExists,
  createInstance,
  listProjectsInInstance,
} from "../config/manager.ts";
import { DEFAULT_INSTANCE } from "../constants.ts";
import { listTemplates, loadBuiltinTemplate, templateExists } from "../templates/index.ts";
import { scanProjectEnvFiles, type EnvOverrideProposal } from "../utils/env-scanner.ts";

/**
 * `sandbox add <path>` — Add a project to an instance.
 *
 * Interactive flow:
 *   1. Validate path, detect project name
 *   2. Pick template (or use --template flag)
 *   3. Load .sandbox.json from project (if exists)
 *   4. Scan .env files for overrides
 *   5. Prompt for additional overrides
 *   6. Prompt for secrets
 *   7. Prompt for custom services
 *   8. Check port conflicts
 *   9. Save project config
 */
export async function addCommand(
  projectPath: string,
  options: { template?: string; instance?: string }
): Promise<void> {
  if (!isInitialized()) {
    console.log(
      chalk.red("Not initialized. Run `sandbox init` first.")
    );
    process.exit(1);
  }

  // ── Resolve project path ────────────────────────────────────────
  const absPath = path.resolve(projectPath);
  if (!fs.existsSync(absPath)) {
    console.log(chalk.red(`Path does not exist: ${absPath}`));
    process.exit(1);
  }
  if (!fs.statSync(absPath).isDirectory()) {
    console.log(chalk.red(`Not a directory: ${absPath}`));
    process.exit(1);
  }

  const projectName = path.basename(absPath);
  const instanceName = options.instance ?? DEFAULT_INSTANCE;

  console.log(chalk.bold(`\nAdding project: ${projectName}`));
  console.log(chalk.dim(`  Path: ${absPath}`));
  console.log(chalk.dim(`  Instance: ${instanceName}\n`));

  // ── Ensure instance exists ──────────────────────────────────────
  if (!instanceExists(instanceName)) {
    const create = await confirm({
      message: `Instance "${instanceName}" doesn't exist. Create it?`,
      default: true,
    });
    if (!create) {
      console.log(chalk.yellow("Aborted."));
      return;
    }
    createInstance(instanceName);
  }

  // ── Check for existing project ──────────────────────────────────
  const existing = listProjectsInInstance(instanceName);
  if (existing.some((p) => p.name === projectName)) {
    const overwrite = await confirm({
      message: `Project "${projectName}" already exists in instance "${instanceName}". Replace it?`,
      default: false,
    });
    if (!overwrite) {
      console.log(chalk.yellow("Aborted."));
      return;
    }
  }

  // ── Load .sandbox.json from project (if exists) ─────────────────
  const sandboxFile = loadProjectSandboxFile(absPath);
  if (sandboxFile) {
    console.log(
      chalk.dim(`  Found .sandbox.json in project root — will merge.\n`)
    );
  }

  // ── Pick template ───────────────────────────────────────────────
  let templateName = options.template ?? sandboxFile?.template;

  if (!templateName) {
    const templates = listTemplates();
    templateName = await select({
      message: "Project template:",
      choices: templates.map((t) => ({
        name: `${t.name} — ${t.description}`,
        value: t.name,
      })),
    });
  }

  if (!templateExists(templateName)) {
    console.log(chalk.red(`Unknown template: ${templateName}`));
    process.exit(1);
  }

  const template = loadBuiltinTemplate(templateName)!;
  console.log(chalk.dim(`  Template: ${template.name}\n`));

  // ── GitHub PAT ──────────────────────────────────────────────────
  const globalConfig = loadGlobalConfig();
  let githubPat: string | "default" = "default";

  if (globalConfig.defaultGithubPat) {
    const useDefault = await confirm({
      message: "Use default GitHub PAT for this project?",
      default: true,
    });
    if (!useDefault) {
      const pat = await password({
        message: "GitHub PAT for this project:",
      });
      if (pat) githubPat = pat;
    }
  } else {
    const pat = await password({
      message: "GitHub PAT for this project (leave empty to skip):",
    });
    if (pat) githubPat = pat;
  }

  // ── Scan .env files for overrides ───────────────────────────────
  console.log(chalk.bold("\nScanning .env files..."));
  const proposals = scanProjectEnvFiles(absPath, template.envRewriteRules);

  const envOverrides: Record<string, string> = {
    ...template.envOverrides,
    ...(sandboxFile?.env?.override ?? {}),
  };

  if (proposals.length > 0) {
    console.log(
      chalk.dim(
        `  Found ${proposals.length} env var(s) that need container overrides:\n`
      )
    );
    for (const p of proposals) {
      console.log(
        `    ${chalk.cyan(p.key)}: ${chalk.dim(p.originalValue)} → ${chalk.green(p.overrideValue)}`
      );
      console.log(chalk.dim(`      From: ${p.file} (${p.reason})`));
    }

    const acceptOverrides = await confirm({
      message: "Accept these overrides?",
      default: true,
    });
    if (acceptOverrides) {
      for (const p of proposals) {
        envOverrides[p.key] = p.overrideValue;
      }
    }
  } else {
    console.log(chalk.dim("  No automatic overrides detected.\n"));
  }

  // ── Custom env overrides ────────────────────────────────────────
  let addMoreOverrides = await confirm({
    message: "Add custom env var overrides?",
    default: false,
  });

  while (addMoreOverrides) {
    const key = await input({
      message: "Variable name:",
      validate: (v) => (v.trim().length > 0 ? true : "Required"),
    });
    const value = await input({
      message: `Value for ${key} inside container:`,
      validate: (v) => (v.trim().length > 0 ? true : "Required"),
    });
    envOverrides[key.trim()] = value.trim();
    console.log(
      chalk.dim(`  Added: ${key.trim()} = ${value.trim()}`)
    );

    addMoreOverrides = await confirm({
      message: "Add another override?",
      default: false,
    });
  }

  // ── Secrets ─────────────────────────────────────────────────────
  const envSecrets: string[] = [
    ...template.defaultSecrets,
    ...(sandboxFile?.env?.secrets ?? []),
  ];

  console.log(chalk.bold("\nSecrets"));
  console.log(
    chalk.dim(
      "These are stored in ~/.config (never in the project repo).\n"
    )
  );

  // Prompt for values of declared secrets that aren't already set
  for (const secretName of envSecrets) {
    if (secretName === "GH_TOKEN") continue; // Already handled via PAT
    const val = await password({
      message: `Value for ${secretName} (leave empty to skip):`,
    });
    if (val) {
      envOverrides[secretName] = val;
    }
  }

  let addMoreSecrets = await confirm({
    message: "Add additional secrets?",
    default: false,
  });

  while (addMoreSecrets) {
    const key = await input({
      message: "Secret variable name:",
      validate: (v) => (v.trim().length > 0 ? true : "Required"),
    });
    envSecrets.push(key.trim());
    const val = await password({
      message: `Value for ${key.trim()}:`,
    });
    if (val) {
      envOverrides[key.trim()] = val;
    }

    addMoreSecrets = await confirm({
      message: "Add another secret?",
      default: false,
    });
  }

  // ── Services ────────────────────────────────────────────────────
  console.log(chalk.bold("\nServices"));
  console.log(
    chalk.dim(
      `Template "${template.name}" includes these services by default:\n`
    )
  );

  for (const svc of template.services.container) {
    console.log(
      `  [container/${svc.type}] ${chalk.cyan(svc.name)}: ${svc.command}${svc.port ? ` (port ${svc.port})` : ""}`
    );
  }
  for (const svc of template.services.host) {
    console.log(
      `  [host/${svc.type}] ${chalk.cyan(svc.name)}: ${svc.start}`
    );
  }

  const containerServices: ContainerService[] = [
    ...template.services.container,
    ...(sandboxFile?.services?.container ?? []),
  ];
  const hostServices: HostService[] = [
    ...template.services.host,
    ...(sandboxFile?.services?.host ?? []),
  ];

  // Custom container services
  let addContainerSvc = await confirm({
    message: "\nAdd custom container services (dev servers, watchers, etc.)?",
    default: false,
  });

  while (addContainerSvc) {
    const svc = await promptContainerService();
    containerServices.push(svc);
    console.log(
      chalk.dim(`  Added container service: ${svc.name}`)
    );

    addContainerSvc = await confirm({
      message: "Add another container service?",
      default: false,
    });
  }

  // Custom host services
  let addHostSvc = await confirm({
    message: "Add custom host services (databases, external tools, etc.)?",
    default: false,
  });

  while (addHostSvc) {
    const svc = await promptHostService();
    hostServices.push(svc);
    console.log(
      chalk.dim(`  Added host service: ${svc.name}`)
    );

    addHostSvc = await confirm({
      message: "Add another host service?",
      default: false,
    });
  }

  // ── Port mappings ───────────────────────────────────────────────
  const ports: string[] = [
    ...template.ports,
    ...(sandboxFile?.ports ?? []),
  ];

  // Collect ports from services
  for (const svc of containerServices) {
    if (svc.port) {
      const mapping = `${svc.port}:${svc.port}`;
      if (!ports.includes(mapping)) ports.push(mapping);
    }
  }

  // Check for port conflicts with existing projects
  const existingPorts = new Set<string>();
  for (const proj of existing) {
    if (proj.name === projectName) continue;
    for (const p of proj.ports) existingPorts.add(p.split(":")[0]!);
  }

  const conflictingPorts = ports.filter((p) =>
    existingPorts.has(p.split(":")[0]!)
  );
  if (conflictingPorts.length > 0) {
    console.log(
      chalk.yellow(
        `\nWarning: Port conflict with existing projects: ${conflictingPorts.join(", ")}`
      )
    );
    console.log(
      chalk.dim(
        "You may need to change ports or move this project to a separate instance.\n"
      )
    );
  }

  // ── Passthrough env vars ────────────────────────────────────────
  const envPassthrough: string[] = sandboxFile?.env?.passthrough ?? [];

  // ── Permission ──────────────────────────────────────────────────
  const permissionSetting = sandboxFile?.permission ?? template.permission;

  // ── Build project config ────────────────────────────────────────
  const projectConfig: ProjectConfig = {
    name: projectName,
    hostPath: absPath,
    instance: instanceName,
    template: templateName,
    githubPat,
    services: {
      container: containerServices,
      host: hostServices,
    },
    envOverrides,
    envPassthrough,
    envSecrets,
    ports,
    mcp: sandboxFile?.mcp ?? template.mcp,
    permission: permissionSetting,
  };

  // ── Save ────────────────────────────────────────────────────────
  saveProjectConfig(instanceName, projectConfig);

  // Update instance config
  const instanceConfig = loadInstanceConfig(instanceName)!;
  if (!instanceConfig.projects.includes(projectName)) {
    instanceConfig.projects.push(projectName);
    saveInstanceConfig(instanceConfig);
  }

  console.log(chalk.green(`\nProject "${projectName}" added to instance "${instanceName}".`));
  console.log(`\nNext steps:`);
  console.log(`  ${chalk.cyan("sandbox build")} — generate Docker files`);
  console.log(`  ${chalk.cyan("sandbox up")} — start the sandbox`);
}

// ── Interactive service prompts ────────────────────────────────────────────

async function promptContainerService(): Promise<ContainerService> {
  const name = await input({
    message: "Service name:",
    validate: (v) => (v.trim().length > 0 ? true : "Required"),
  });

  const command = await input({
    message: "Command to run:",
    validate: (v) => (v.trim().length > 0 ? true : "Required"),
  });

  const type = await select<"daemon" | "oneshot">({
    message: "Service type:",
    choices: [
      { name: "daemon — long-running process (monitored)", value: "daemon" },
      { name: "oneshot — run once and exit (e.g., install deps)", value: "oneshot" },
    ],
  });

  let portNum: number | undefined;
  const hasPort = await confirm({
    message: "Does this service listen on a port?",
    default: false,
  });
  if (hasPort) {
    const portStr = await input({
      message: "Port number:",
      validate: (v) => {
        const n = parseInt(v, 10);
        return n > 0 && n < 65536 ? true : "Must be 1-65535";
      },
    });
    portNum = parseInt(portStr, 10);
  }

  let restart: "always" | "on-failure" | "never" = "never";
  if (type === "daemon") {
    restart = await select({
      message: "Restart policy:",
      choices: [
        { name: "always — restart on any exit", value: "always" as const },
        { name: "on-failure — restart only on non-zero exit", value: "on-failure" as const },
        { name: "never — let it die", value: "never" as const },
      ],
    });
  }

  const depsStr = await input({
    message: "Depends on (comma-separated service names, or empty):",
  });
  const dependsOn = depsStr
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    name: name.trim(),
    command: command.trim(),
    type,
    port: portNum,
    restart,
    dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
  };
}

async function promptHostService(): Promise<HostService> {
  const name = await input({
    message: "Service name:",
    validate: (v) => (v.trim().length > 0 ? true : "Required"),
  });

  const start = await input({
    message: "Start command:",
    validate: (v) => (v.trim().length > 0 ? true : "Required"),
  });

  const stop = await input({
    message: "Stop command:",
    validate: (v) => (v.trim().length > 0 ? true : "Required"),
  });

  const type = await select<"daemon" | "oneshot">({
    message: "Service type:",
    choices: [
      { name: "daemon — long-running process", value: "daemon" },
      { name: "oneshot — run and exit (e.g., docker compose up)", value: "oneshot" },
    ],
  });

  const healthCheck = await input({
    message: "Health check command (optional):",
  });

  const workdir = await input({
    message: "Working directory on host (optional):",
  });

  const depsStr = await input({
    message: "Depends on (comma-separated service names, or empty):",
  });
  const dependsOn = depsStr
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    name: name.trim(),
    start: start.trim(),
    stop: stop.trim(),
    type,
    healthCheck: healthCheck.trim() || undefined,
    workdir: workdir.trim() || undefined,
    dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
  };
}
