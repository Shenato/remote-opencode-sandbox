import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import {
  loadInstanceConfig,
  saveInstanceConfig,
  deleteProjectConfig,
  listProjectsInInstance,
  instanceExists,
} from "../config/manager.ts";

/**
 * `sandbox remove <project> [--instance]`
 */
export async function removeCommand(
  projectName: string,
  options: { instance: string }
): Promise<void> {
  const { instance: instanceName } = options;

  if (!instanceExists(instanceName)) {
    console.log(chalk.red(`Instance "${instanceName}" does not exist.`));
    process.exit(1);
  }

  const projects = listProjectsInInstance(instanceName);
  const project = projects.find((p) => p.name === projectName);

  if (!project) {
    console.log(
      chalk.red(
        `Project "${projectName}" not found in instance "${instanceName}".`
      )
    );
    process.exit(1);
  }

  const yes = await confirm({
    message: `Remove project "${projectName}" from instance "${instanceName}"?`,
    default: false,
  });

  if (!yes) {
    console.log(chalk.yellow("Aborted."));
    return;
  }

  // Remove from instance config
  const instanceConfig = loadInstanceConfig(instanceName)!;
  instanceConfig.projects = instanceConfig.projects.filter(
    (p) => p !== projectName
  );
  saveInstanceConfig(instanceConfig);

  // Delete project config file
  deleteProjectConfig(instanceName, projectName);

  console.log(
    chalk.green(`Project "${projectName}" removed from instance "${instanceName}".`)
  );
  console.log(
    chalk.dim(`Run ${chalk.cyan("sandbox build")} to regenerate Docker files.`)
  );
}
