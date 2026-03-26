import chalk from "chalk";
import { confirm, input } from "@inquirer/prompts";
import {
  instanceExists,
  createInstance,
  deleteInstance,
  listInstances,
  loadInstanceConfig,
  listProjectsInInstance,
} from "../config/manager.ts";

/**
 * `sandbox instance create <name>`
 */
export async function instanceCreateCommand(name: string): Promise<void> {
  if (instanceExists(name)) {
    console.log(chalk.red(`Instance "${name}" already exists.`));
    process.exit(1);
  }

  createInstance(name);
  console.log(chalk.green(`Instance "${name}" created.`));
  console.log(
    chalk.dim(`Add projects with: sandbox add <path> --instance ${name}`)
  );
}

/**
 * `sandbox instance list`
 */
export function instanceListCommand(): void {
  const instances = listInstances();

  if (instances.length === 0) {
    console.log(chalk.dim("No instances configured."));
    return;
  }

  for (const name of instances) {
    const projects = listProjectsInInstance(name);
    console.log(
      `  ${chalk.bold(name)} — ${projects.length} project(s)`
    );
    for (const proj of projects) {
      console.log(
        chalk.dim(`    ${proj.name} (${proj.template})`)
      );
    }
  }
}

/**
 * `sandbox instance remove <name>`
 */
export async function instanceRemoveCommand(name: string): Promise<void> {
  if (!instanceExists(name)) {
    console.log(chalk.red(`Instance "${name}" does not exist.`));
    process.exit(1);
  }

  const projects = listProjectsInInstance(name);
  if (projects.length > 0) {
    console.log(
      chalk.yellow(
        `Instance "${name}" has ${projects.length} project(s): ${projects.map((p) => p.name).join(", ")}`
      )
    );
  }

  const yes = await confirm({
    message: `Delete instance "${name}" and all its config?`,
    default: false,
  });

  if (!yes) {
    console.log(chalk.yellow("Aborted."));
    return;
  }

  deleteInstance(name);
  console.log(chalk.green(`Instance "${name}" deleted.`));
}
