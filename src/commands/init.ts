import { input, password, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import {
  isInitialized,
  saveGlobalConfig,
  loadGlobalConfig,
  createInstance,
  instanceExists,
} from "../config/manager.ts";
import { DEFAULT_INSTANCE, CONFIG_DIR } from "../constants.ts";
import type { GlobalConfig } from "../types.ts";

/**
 * `sandbox init` — First-time global setup.
 *
 * Prompts for:
 *   - Git identity (name, email)
 *   - Default GitHub PAT
 *   - Creates default instance
 */
export async function initCommand(): Promise<void> {
  if (isInitialized()) {
    const overwrite = await confirm({
      message: "Sandbox is already initialized. Reinitialize?",
      default: false,
    });
    if (!overwrite) {
      console.log(chalk.yellow("Aborted."));
      return;
    }
  }

  console.log(chalk.bold("\nremote-opencode-sandbox setup\n"));
  console.log(
    chalk.dim(
      `Config will be stored in: ${CONFIG_DIR}\n`
    )
  );

  // ── Git identity ────────────────────────────────────────────────
  console.log(chalk.bold("Git identity"));
  console.log(
    chalk.dim("Used for commits made by OpenCode inside the container.\n")
  );

  const gitName = await input({
    message: "Git author name:",
    validate: (v) => (v.trim().length > 0 ? true : "Required"),
  });

  const gitEmail = await input({
    message: "Git author email:",
    validate: (v) => (v.includes("@") ? true : "Must be a valid email"),
  });

  // ── Default GitHub PAT ──────────────────────────────────────────
  console.log(chalk.bold("\nGitHub Personal Access Token"));
  console.log(
    chalk.dim(
      "Fine-grained PAT with repo access. Can be overridden per-project.\n"
    )
  );

  const ghToken = await password({
    message: "Default GitHub PAT (leave empty to set later):",
  });

  // ── Save global config ──────────────────────────────────────────
  const config: GlobalConfig = {
    git: { name: gitName.trim(), email: gitEmail.trim() },
    defaultGithubPat: ghToken || undefined,
    defaultInstance: DEFAULT_INSTANCE,
  };

  saveGlobalConfig(config);

  // ── Create default instance ─────────────────────────────────────
  if (!instanceExists(DEFAULT_INSTANCE)) {
    createInstance(DEFAULT_INSTANCE);
  }

  console.log(chalk.green("\nInitialized successfully."));
  console.log(chalk.dim(`  Config: ${CONFIG_DIR}/config.json`));
  console.log(chalk.dim(`  Instance: ${DEFAULT_INSTANCE}\n`));
  console.log(`Next: ${chalk.cyan("sandbox add <path-to-project>")}`);
}
