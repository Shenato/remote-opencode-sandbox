import { Command } from "commander";
import chalk from "chalk";
import { DEFAULT_INSTANCE } from "./constants.ts";
import { initCommand } from "./commands/init.ts";
import { addCommand } from "./commands/add.ts";
import { removeCommand } from "./commands/remove.ts";
import { buildInstance } from "./commands/build.ts";
import {
  upCommand,
  downCommand,
  restartCommand,
  restartBotCommand,
  logsCommand,
  shellCommand,
  statusCommand,
} from "./commands/operations.ts";
import { configCommand, configEditCommand } from "./commands/config.ts";
import { templatesCommand } from "./commands/templates.ts";
import {
  instanceCreateCommand,
  instanceListCommand,
  instanceRemoveCommand,
} from "./commands/instance.ts";
import { setupAutostartCommand } from "./commands/autostart.ts";
import { addRepoCommand, removeRepoCommand } from "./commands/add-repo.ts";

export function runCli(): void {
  const program = new Command();

  program
    .name("sandbox")
    .description(
      "Run OpenCode in a secure Docker sandbox, accessible via Discord.\nMulti-project, templated, auto-configured."
    )
    .version("0.1.0");

  // ── init ────────────────────────────────────────────────────────
  program
    .command("init")
    .description("First-time setup: git identity, default GitHub PAT")
    .action(async () => {
      await initCommand();
    });

  // ── add ─────────────────────────────────────────────────────────
  program
    .command("add <path>")
    .description("Add a project to the sandbox")
    .option("-t, --template <name>", "Template to use (e.g., web-supabase)")
    .option(
      "-i, --instance <name>",
      "Instance to add to",
      DEFAULT_INSTANCE
    )
    .action(async (projectPath: string, options) => {
      await addCommand(projectPath, options);
    });

  // ── remove ──────────────────────────────────────────────────────
  program
    .command("remove <project>")
    .description("Remove a project from the sandbox")
    .option(
      "-i, --instance <name>",
      "Instance to remove from",
      DEFAULT_INSTANCE
    )
    .action(async (project: string, options) => {
      await removeCommand(project, options);
    });

  // ── build ───────────────────────────────────────────────────────
  program
    .command("build")
    .description("Generate Docker files from config")
    .option(
      "-i, --instance <name>",
      "Instance to build",
      DEFAULT_INSTANCE
    )
    .action((options) => {
      console.log(chalk.dim("Building sandbox files...\n"));
      const result = buildInstance(options.instance);
      if (!result.success) {
        console.log(chalk.red(`Build failed: ${result.error}`));
        process.exit(1);
      }
      console.log(chalk.green(`Generated files in: ${result.generatedDir}`));
      console.log(
        chalk.dim(
          `\nFiles are editable. Run ${chalk.cyan("sandbox up")} to start.`
        )
      );
    });

  // ── up ──────────────────────────────────────────────────────────
  program
    .command("up")
    .description("Build and start the sandbox")
    .option(
      "-i, --instance <name>",
      "Instance to start",
      DEFAULT_INSTANCE
    )
    .option("--no-build", "Skip regenerating Docker files")
    .action(async (options) => {
      await upCommand({ instance: options.instance, build: options.build });
    });

  // ── down ────────────────────────────────────────────────────────
  program
    .command("down")
    .description("Stop the sandbox")
    .option(
      "-i, --instance <name>",
      "Instance to stop",
      DEFAULT_INSTANCE
    )
    .action(async (options) => {
      await downCommand(options);
    });

  // ── restart ─────────────────────────────────────────────────────
  program
    .command("restart")
    .description("Restart the sandbox")
    .option(
      "-i, --instance <name>",
      "Instance to restart",
      DEFAULT_INSTANCE
    )
    .action(async (options) => {
      await restartCommand(options);
    });

  // ── restart-bot ────────────────────────────────────────────────
  program
    .command("restart-bot")
    .description("Restart the Discord bot without restarting the container")
    .option(
      "-i, --instance <name>",
      "Instance",
      DEFAULT_INSTANCE
    )
    .action((options) => {
      restartBotCommand(options);
    });

  // ── logs ────────────────────────────────────────────────────────
  program
    .command("logs")
    .description("View sandbox logs")
    .option(
      "-i, --instance <name>",
      "Instance",
      DEFAULT_INSTANCE
    )
    .option("-f, --follow", "Follow log output")
    .action((options) => {
      logsCommand(options);
    });

  // ── shell ───────────────────────────────────────────────────────
  program
    .command("shell")
    .description("Open a shell in the sandbox container")
    .option(
      "-i, --instance <name>",
      "Instance",
      DEFAULT_INSTANCE
    )
    .action((options) => {
      shellCommand(options);
    });

  // ── status ──────────────────────────────────────────────────────
  program
    .command("status")
    .description("Show sandbox status for all instances")
    .action(() => {
      statusCommand();
    });

  // ── config ──────────────────────────────────────────────────────
  const configCmd = program
    .command("config")
    .description("View or edit configuration");

  configCmd
    .command("show [project]")
    .description("Show global or project config")
    .option(
      "-i, --instance <name>",
      "Instance",
      DEFAULT_INSTANCE
    )
    .action((project, options) => {
      configCommand(project, options);
    });

  configCmd
    .command("edit")
    .description("Open config directory in $EDITOR")
    .option(
      "-i, --instance <name>",
      "Instance",
      DEFAULT_INSTANCE
    )
    .action((options) => {
      configEditCommand(options);
    });

  // ── templates ───────────────────────────────────────────────────
  program
    .command("templates")
    .description("List available project templates")
    .action(() => {
      templatesCommand();
    });

  // ── instance ────────────────────────────────────────────────────
  const instanceCmd = program
    .command("instance")
    .description("Manage sandbox instances");

  instanceCmd
    .command("create <name>")
    .description("Create a new instance")
    .action(async (name) => {
      await instanceCreateCommand(name);
    });

  instanceCmd
    .command("list")
    .description("List all instances")
    .action(() => {
      instanceListCommand();
    });

  instanceCmd
    .command("remove <name>")
    .description("Delete an instance and its config")
    .action(async (name) => {
      await instanceRemoveCommand(name);
    });

  // ── add-repo ────────────────────────────────────────────────────
  program
    .command("add-repo <url>")
    .description("Add an extra repository to be cloned inside the container")
    .option(
      "-i, --instance <name>",
      "Instance to add to",
      DEFAULT_INSTANCE
    )
    .action((url: string, options) => {
      addRepoCommand(url, options);
    });

  // ── remove-repo ────────────────────────────────────────────────
  program
    .command("remove-repo <url-or-name>")
    .description("Remove an extra repository from an instance")
    .option(
      "-i, --instance <name>",
      "Instance to remove from",
      DEFAULT_INSTANCE
    )
    .action((urlOrName: string, options) => {
      removeRepoCommand(urlOrName, options);
    });

  // ── setup-autostart ─────────────────────────────────────────────
  program
    .command("setup-autostart")
    .description("Set up auto-start on boot (Linux/Ubuntu)")
    .action(async () => {
      await setupAutostartCommand();
    });

  program.parse();
}
