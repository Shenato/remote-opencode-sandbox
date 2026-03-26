import { execSync, spawn } from "node:child_process";
import chalk from "chalk";
import {
  instanceExists,
  instanceGeneratedDir,
  loadInstanceConfig,
  listInstances,
  listProjectsInInstance,
  resolveInstance,
} from "../config/manager.ts";
import { buildInstance } from "./build.ts";

/**
 * `sandbox up [--instance]` — Build (if needed) and start the sandbox.
 *
 * 1. Generate Docker files if they don't exist
 * 2. Start host services
 * 3. docker compose up -d
 */
export async function upCommand(options: {
  instance: string;
  build?: boolean;
}): Promise<void> {
  const { instance: instanceName } = options;

  if (!instanceExists(instanceName)) {
    console.log(chalk.red(`Instance "${instanceName}" does not exist.`));
    process.exit(1);
  }

  const projects = listProjectsInInstance(instanceName);
  if (projects.length === 0) {
    console.log(
      chalk.red(
        `Instance "${instanceName}" has no projects. Run: sandbox add <path>`
      )
    );
    process.exit(1);
  }

  // ── Build if needed ─────────────────────────────────────────────
  const genDir = instanceGeneratedDir(instanceName);
  if (options.build !== false) {
    console.log(chalk.dim("Building sandbox files..."));
    const result = buildInstance(instanceName);
    if (!result.success) {
      console.log(chalk.red(`Build failed: ${result.error}`));
      process.exit(1);
    }
    console.log(chalk.dim(`  Generated files in: ${genDir}\n`));
  }

  // ── Start host services ─────────────────────────────────────────
  const resolved = resolveInstance(instanceName);
  if (resolved && resolved.allHostServices.length > 0) {
    console.log(chalk.bold("Starting host services..."));
    for (const svc of resolved.allHostServices) {
      console.log(chalk.dim(`  [${svc.type}] ${svc.name}: ${svc.start}`));
      try {
        if (svc.type === "oneshot") {
          execSync(svc.start, {
            cwd: svc.workdir,
            stdio: "inherit",
            timeout: 300000, // 5 min for things like supabase start
          });
        } else {
          // Daemon: run in background with nohup
          const child = spawn("bash", ["-c", `nohup ${svc.start} &`], {
            cwd: svc.workdir,
            detached: true,
            stdio: "ignore",
          });
          child.unref();
        }
        console.log(chalk.green(`  ✓ ${svc.name}`));
      } catch (err) {
        console.log(
          chalk.yellow(`  ⚠ ${svc.name} failed (continuing anyway)`)
        );
      }
    }
    console.log("");
  }

  // ── Docker compose up ───────────────────────────────────────────
  console.log(chalk.bold("Starting sandbox container..."));
  try {
    execSync(
      `docker compose -f docker-compose.yml build && docker compose -f docker-compose.yml up -d`,
      {
        cwd: genDir,
        stdio: "inherit",
        timeout: 600000, // 10 min for image build
      }
    );
    console.log(chalk.green("\nSandbox is running."));
    console.log(chalk.dim(`  Container: sandbox-${instanceName}`));

    // Show ports
    const portInfo = resolved?.ports.length
      ? resolved.ports.map((p) => `    ${p}`).join("\n")
      : "    (none)";
    console.log(chalk.dim(`  Ports:\n${portInfo}`));
    console.log(
      chalk.dim(
        `\n  View logs: sandbox logs\n  Open shell: sandbox shell\n`
      )
    );
  } catch {
    console.log(chalk.red("\nFailed to start sandbox container."));
    process.exit(1);
  }
}

/**
 * `sandbox down [--instance]` — Stop the sandbox.
 */
export async function downCommand(options: {
  instance: string;
}): Promise<void> {
  const { instance: instanceName } = options;

  if (!instanceExists(instanceName)) {
    console.log(chalk.red(`Instance "${instanceName}" does not exist.`));
    process.exit(1);
  }

  const genDir = instanceGeneratedDir(instanceName);

  // ── Stop container ──────────────────────────────────────────────
  console.log(chalk.dim("Stopping sandbox container..."));
  try {
    execSync(`docker compose -f docker-compose.yml down`, {
      cwd: genDir,
      stdio: "inherit",
      timeout: 60000,
    });
  } catch {
    // May already be stopped
  }

  // ── Stop host services ──────────────────────────────────────────
  const resolved = resolveInstance(instanceName);
  if (resolved && resolved.allHostServices.length > 0) {
    console.log(chalk.dim("\nStopping host services..."));
    for (const svc of resolved.allHostServices) {
      try {
        execSync(svc.stop, {
          cwd: svc.workdir,
          stdio: "inherit",
          timeout: 60000,
        });
        console.log(chalk.dim(`  ✓ Stopped ${svc.name}`));
      } catch {
        // May already be stopped
      }
    }
  }

  console.log(chalk.green("\nSandbox stopped."));
}

/**
 * `sandbox restart [--instance]`
 */
export async function restartCommand(options: {
  instance: string;
}): Promise<void> {
  await downCommand(options);
  await upCommand({ ...options, build: true });
}

/**
 * `sandbox logs [--instance] [--follow]`
 */
export function logsCommand(options: {
  instance: string;
  follow?: boolean;
}): void {
  const genDir = instanceGeneratedDir(options.instance);
  const followFlag = options.follow ? "-f" : "--tail 100";
  try {
    execSync(`docker compose -f docker-compose.yml logs ${followFlag}`, {
      cwd: genDir,
      stdio: "inherit",
    });
  } catch {
    // User pressed Ctrl+C
  }
}

/**
 * `sandbox shell [--instance]`
 */
export function shellCommand(options: { instance: string }): void {
  const genDir = instanceGeneratedDir(options.instance);
  try {
    execSync(`docker compose -f docker-compose.yml exec sandbox bash`, {
      cwd: genDir,
      stdio: "inherit",
    });
  } catch {
    console.log(chalk.yellow("Shell exited."));
  }
}

/**
 * `sandbox status`
 */
export function statusCommand(): void {
  const instances = listInstances();

  if (instances.length === 0) {
    console.log(chalk.dim("No instances configured."));
    console.log(chalk.dim(`Run: sandbox init && sandbox add <path>`));
    return;
  }

  for (const name of instances) {
    const config = loadInstanceConfig(name);
    const projects = listProjectsInInstance(name);

    // Check if container is running
    let containerStatus = "stopped";
    try {
      const out = execSync(
        `docker inspect -f '{{.State.Status}}' sandbox-${name} 2>/dev/null`,
        { encoding: "utf-8" }
      ).trim();
      containerStatus = out || "stopped";
    } catch {
      containerStatus = "not created";
    }

    const statusColor =
      containerStatus === "running" ? chalk.green : chalk.yellow;

    console.log(
      `\n${chalk.bold(name)} — ${statusColor(containerStatus)}`
    );

    if (projects.length === 0) {
      console.log(chalk.dim("  (no projects)"));
    } else {
      for (const proj of projects) {
        console.log(
          `  ${chalk.cyan(proj.name)} ${chalk.dim(`(${proj.template})`)} ${chalk.dim(proj.hostPath)}`
        );
        if (proj.ports.length > 0) {
          console.log(
            chalk.dim(`    Ports: ${proj.ports.join(", ")}`)
          );
        }
      }
    }
  }
  console.log("");
}
