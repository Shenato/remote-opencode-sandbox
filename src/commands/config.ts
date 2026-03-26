import { execSync } from "node:child_process";
import chalk from "chalk";
import {
  loadGlobalConfig,
  loadInstanceConfig,
  loadProjectConfig,
  listInstances,
  listProjectsInInstance,
  instanceGeneratedDir,
  instanceExists,
} from "../config/manager.ts";

/**
 * `sandbox config` — Show global config.
 * `sandbox config <project> [--instance]` — Show project config.
 */
export function configCommand(
  projectName?: string,
  options?: { instance?: string }
): void {
  if (!projectName) {
    // Show global config
    const config = loadGlobalConfig();
    console.log(chalk.bold("\nGlobal config:\n"));
    console.log(JSON.stringify(config, null, 2));

    const instances = listInstances();
    if (instances.length > 0) {
      console.log(chalk.bold("\nInstances:\n"));
      for (const name of instances) {
        const projects = listProjectsInInstance(name);
        console.log(
          `  ${name}: ${projects.map((p) => p.name).join(", ") || "(empty)"}`
        );
      }
    }
    console.log("");
    return;
  }

  // Show project config
  const instanceName = options?.instance ?? "default";
  if (!instanceExists(instanceName)) {
    console.log(chalk.red(`Instance "${instanceName}" does not exist.`));
    process.exit(1);
  }

  const project = loadProjectConfig(instanceName, projectName);
  if (!project) {
    console.log(
      chalk.red(
        `Project "${projectName}" not found in instance "${instanceName}".`
      )
    );
    process.exit(1);
  }

  console.log(chalk.bold(`\nProject config: ${projectName}\n`));
  console.log(JSON.stringify(project, null, 2));
  console.log("");
}

/**
 * `sandbox config edit [--instance]` — Open config directory in $EDITOR.
 */
export function configEditCommand(options: { instance: string }): void {
  const genDir = instanceGeneratedDir(options.instance);
  const editor = process.env.EDITOR || "nano";

  console.log(chalk.dim(`Opening ${genDir} in ${editor}...\n`));

  try {
    execSync(`${editor} "${genDir}"`, { stdio: "inherit" });
  } catch {
    console.log(chalk.yellow(`Could not open editor. Config dir: ${genDir}`));
  }
}
