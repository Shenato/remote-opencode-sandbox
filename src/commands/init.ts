import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { input, password, confirm, select } from "@inquirer/prompts";
import chalk from "chalk";
import {
  isInitialized,
  saveGlobalConfig,
  loadGlobalConfig,
  createInstance,
  instanceExists,
} from "../config/manager.ts";
import { DEFAULT_INSTANCE, CONFIG_DIR } from "../constants.ts";
import type { GlobalConfig, SshConfig } from "../types.ts";

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

  // ── SSH key (optional) ─────────────────────────────────────────
  console.log(chalk.bold("\nSSH Key for Git Authentication"));
  console.log(
    chalk.dim(
      "Optional: mount an SSH private key for git operations (GitHub, etc.).\n"
    )
  );

  let sshConfig: SshConfig | undefined;
  const sshDir = path.join(os.homedir(), ".ssh");
  const detectedKeys: string[] = [];

  // Auto-detect SSH private keys
  if (fs.existsSync(sshDir)) {
    try {
      const entries = fs.readdirSync(sshDir);
      for (const entry of entries) {
        // Skip public keys, known_hosts, config, authorized_keys
        if (
          entry.endsWith(".pub") ||
          entry === "known_hosts" ||
          entry === "known_hosts.old" ||
          entry === "config" ||
          entry === "authorized_keys" ||
          entry === "authorized_keys2" ||
          entry === "environment"
        ) {
          continue;
        }
        const fullPath = path.join(sshDir, entry);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;
        // Check if it looks like a private key (first line check)
        try {
          const head = fs.readFileSync(fullPath, { encoding: "utf-8", flag: "r" }).slice(0, 50);
          if (head.includes("PRIVATE KEY") || head.includes("OPENSSH PRIVATE KEY")) {
            detectedKeys.push(`~/.ssh/${entry}`);
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Skip if we can't read ~/.ssh
    }
  }

  const useSSH = await confirm({
    message: detectedKeys.length > 0
      ? `Found ${detectedKeys.length} SSH key(s). Configure SSH key for git?`
      : "Configure an SSH key for git authentication?",
    default: detectedKeys.length > 0,
  });

  if (useSSH) {
    let sshKeyPath: string;

    if (detectedKeys.length > 0) {
      const choices = [
        ...detectedKeys.map((k) => ({ name: k, value: k })),
        { name: "Enter a custom path", value: "__custom__" },
      ];
      const selected = await select({
        message: "Which SSH key to use?",
        choices,
      });

      if (selected === "__custom__") {
        sshKeyPath = await input({
          message: "Path to SSH private key:",
          validate: (v) => {
            const expanded = v.trim().replace(/^~/, os.homedir());
            return fs.existsSync(expanded) ? true : `File not found: ${expanded}`;
          },
        });
      } else {
        sshKeyPath = selected;
      }
    } else {
      sshKeyPath = await input({
        message: "Path to SSH private key:",
        default: "~/.ssh/id_ed25519",
        validate: (v) => {
          const expanded = v.trim().replace(/^~/, os.homedir());
          return fs.existsSync(expanded) ? true : `File not found: ${expanded}`;
        },
      });
    }

    sshKeyPath = sshKeyPath.trim();

    const githubUsername = await input({
      message: "GitHub username linked to this key (leave empty to skip):",
    });

    sshConfig = {
      keyPath: sshKeyPath,
      githubUsername: githubUsername.trim() || undefined,
    };
  }

  // ── Save global config ──────────────────────────────────────────
  const config: GlobalConfig = {
    git: { name: gitName.trim(), email: gitEmail.trim() },
    defaultGithubPat: ghToken || undefined,
    ssh: sshConfig,
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
