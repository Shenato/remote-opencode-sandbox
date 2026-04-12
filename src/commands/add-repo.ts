import chalk from "chalk";
import {
  isInitialized,
  loadInstanceConfig,
  saveInstanceConfig,
  instanceExists,
} from "../config/manager.ts";
import { DEFAULT_INSTANCE } from "../constants.ts";

/**
 * `sandbox add-repo <url>` — Add an extra repository to an instance.
 *
 * Extra repos are cloned into /workspace/<repo-name>/ at container startup.
 * They persist across container restarts (via Docker volumes) and are pulled
 * on subsequent boots.
 *
 * This is the host-side command that lets users persist repos the bot created
 * or that the user wants available inside the container without being a full
 * managed project (no template, no host bind mount).
 */
export function addRepoCommand(
  repoUrl: string,
  options: { instance?: string }
): void {
  if (!isInitialized()) {
    console.log(chalk.red("Not initialized. Run `sandbox init` first."));
    process.exit(1);
  }

  const instanceName = options.instance ?? DEFAULT_INSTANCE;

  if (!instanceExists(instanceName)) {
    console.log(chalk.red(`Instance "${instanceName}" does not exist.`));
    process.exit(1);
  }

  // Basic URL validation
  const isHttps = repoUrl.startsWith("https://");
  const isSsh = repoUrl.startsWith("git@");
  if (!isHttps && !isSsh) {
    console.log(
      chalk.red(
        "Invalid repo URL. Expected HTTPS (https://github.com/...) or SSH (git@github.com:...) format."
      )
    );
    process.exit(1);
  }

  // Extract repo name for display
  const repoName =
    repoUrl.replace(/\.git$/, "").split("/").pop()?.split(":").pop() ?? "unknown";

  const instanceConfig = loadInstanceConfig(instanceName)!;

  // Check for duplicates
  const existing = instanceConfig.extraRepos ?? [];
  if (existing.includes(repoUrl)) {
    console.log(
      chalk.yellow(`Repository "${repoName}" is already in instance "${instanceName}".`)
    );
    return;
  }

  // Also check by repo name (different URL, same repo name)
  for (const existingUrl of existing) {
    const existingName =
      existingUrl.replace(/\.git$/, "").split("/").pop()?.split(":").pop() ?? "";
    if (existingName === repoName) {
      console.log(
        chalk.yellow(
          `A repo named "${repoName}" already exists (${existingUrl}). Remove it first or use a different URL.`
        )
      );
      return;
    }
  }

  // Add to instance config
  instanceConfig.extraRepos = [...existing, repoUrl];
  saveInstanceConfig(instanceConfig);

  console.log(
    chalk.green(`Added "${repoName}" to instance "${instanceName}".`)
  );
  console.log(
    chalk.dim(`  URL: ${repoUrl}`)
  );
  console.log(
    chalk.dim(`  Container path: /workspace/${repoName}`)
  );
  console.log(
    `\nRun ${chalk.cyan("sandbox build && sandbox restart")} to apply.`
  );
}

/**
 * `sandbox remove-repo <url-or-name>` — Remove an extra repository from an instance.
 */
export function removeRepoCommand(
  urlOrName: string,
  options: { instance?: string }
): void {
  if (!isInitialized()) {
    console.log(chalk.red("Not initialized. Run `sandbox init` first."));
    process.exit(1);
  }

  const instanceName = options.instance ?? DEFAULT_INSTANCE;

  if (!instanceExists(instanceName)) {
    console.log(chalk.red(`Instance "${instanceName}" does not exist.`));
    process.exit(1);
  }

  const instanceConfig = loadInstanceConfig(instanceName)!;
  const existing = instanceConfig.extraRepos ?? [];

  // Match by full URL or by repo name
  const idx = existing.findIndex((url) => {
    if (url === urlOrName) return true;
    const name =
      url.replace(/\.git$/, "").split("/").pop()?.split(":").pop() ?? "";
    return name === urlOrName;
  });

  if (idx === -1) {
    console.log(
      chalk.yellow(`Repository "${urlOrName}" not found in instance "${instanceName}".`)
    );
    console.log(chalk.dim("Current extra repos:"));
    for (const url of existing) {
      const name =
        url.replace(/\.git$/, "").split("/").pop()?.split(":").pop() ?? "unknown";
      console.log(chalk.dim(`  ${name} — ${url}`));
    }
    return;
  }

  const removedUrl = existing[idx]!;
  const removedName =
    removedUrl.replace(/\.git$/, "").split("/").pop()?.split(":").pop() ?? "unknown";

  instanceConfig.extraRepos = existing.filter((_, i) => i !== idx);
  saveInstanceConfig(instanceConfig);

  console.log(
    chalk.green(`Removed "${removedName}" from instance "${instanceName}".`)
  );
  console.log(
    chalk.dim(
      `Note: The repo data still exists in the container volume. Run "sandbox restart" to apply.`
    )
  );
}
