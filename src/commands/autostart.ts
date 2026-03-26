import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { instanceGeneratedDir, listInstances } from "../config/manager.ts";

/**
 * `sandbox setup-autostart` — Set up systemd user service + XDG autostart for Docker Desktop.
 *
 * Linux/Ubuntu only. Creates:
 *   - ~/.config/systemd/user/sandbox.service
 *   - ~/.config/autostart/Docker-Desktop.desktop (if Docker Desktop is installed)
 */
export async function setupAutostartCommand(): Promise<void> {
  if (process.platform !== "linux") {
    console.log(chalk.red("Auto-start setup is only supported on Linux."));
    process.exit(1);
  }

  const home = os.homedir();
  const instances = listInstances();

  if (instances.length === 0) {
    console.log(chalk.red("No instances configured. Run: sandbox init && sandbox add <path>"));
    process.exit(1);
  }

  console.log(chalk.bold("\nAuto-start setup for Linux/Ubuntu\n"));

  // ── Find sandbox CLI path ───────────────────────────────────────
  let sandboxPath: string;
  try {
    sandboxPath = execSync("which sandbox", { encoding: "utf-8" }).trim();
  } catch {
    // Fallback to bun run
    sandboxPath = `${home}/.bun/bin/bun run ${path.resolve(__dirname, "../cli.ts")}`;
  }

  // ── systemd user service ────────────────────────────────────────
  const systemdDir = path.join(home, ".config", "systemd", "user");
  const servicePath = path.join(systemdDir, "sandbox.service");

  console.log(chalk.bold("1. systemd user service"));
  console.log(chalk.dim(`   Will create: ${servicePath}\n`));

  const createSystemd = await confirm({
    message: "Create systemd user service for auto-start?",
    default: true,
  });

  if (createSystemd) {
    fs.mkdirSync(systemdDir, { recursive: true });

    // Build the ExecStart command
    const bunPath = `${home}/.bun/bin/bun`;

    const serviceContent = `[Unit]
Description=remote-opencode-sandbox
After=graphical-session.target docker.service
Wants=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
Environment=PATH=${home}/.bun/bin:${home}/.opencode/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${bunPath} run ${path.resolve(__dirname, "../cli.ts")} up
ExecStop=${bunPath} run ${path.resolve(__dirname, "../cli.ts")} down
TimeoutStartSec=600
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
`;

    fs.writeFileSync(servicePath, serviceContent, "utf-8");
    console.log(chalk.green(`   Created: ${servicePath}`));

    // Enable linger + service
    try {
      execSync(`loginctl enable-linger ${os.userInfo().username}`, {
        stdio: "inherit",
      });
      execSync("systemctl --user daemon-reload", { stdio: "inherit" });
      execSync("systemctl --user enable sandbox.service", {
        stdio: "inherit",
      });
      console.log(chalk.green("   Service enabled.\n"));
    } catch (err) {
      console.log(chalk.yellow("   Could not enable service automatically."));
      console.log(chalk.dim("   Run manually:"));
      console.log(chalk.dim("     systemctl --user daemon-reload"));
      console.log(chalk.dim("     systemctl --user enable sandbox.service\n"));
    }
  }

  // ── Docker Desktop XDG autostart ────────────────────────────────
  const dockerDesktopPath = "/opt/docker-desktop/bin/docker-desktop";
  if (fs.existsSync(dockerDesktopPath)) {
    console.log(chalk.bold("2. Docker Desktop auto-start"));

    const autostartDir = path.join(home, ".config", "autostart");
    const desktopPath = path.join(autostartDir, "Docker-Desktop.desktop");

    if (fs.existsSync(desktopPath)) {
      console.log(chalk.dim("   Docker Desktop autostart already configured.\n"));
    } else {
      const createAutostart = await confirm({
        message: "Create XDG autostart for Docker Desktop?",
        default: true,
      });

      if (createAutostart) {
        fs.mkdirSync(autostartDir, { recursive: true });

        const desktopContent = `[Desktop Entry]
Type=Application
Name=Docker Desktop
Exec=${dockerDesktopPath}
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Comment=Start Docker Desktop on login
`;

        fs.writeFileSync(desktopPath, desktopContent, "utf-8");
        console.log(chalk.green(`   Created: ${desktopPath}\n`));
      }
    }
  } else {
    console.log(
      chalk.dim(
        "\n2. Docker Desktop not found at /opt/docker-desktop — skipping autostart.\n"
      )
    );
  }

  console.log(chalk.green("Auto-start setup complete."));
  console.log(
    chalk.dim(
      "On next login: Docker Desktop starts → systemd starts sandbox → all projects run.\n"
    )
  );
}
