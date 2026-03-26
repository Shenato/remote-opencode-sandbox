import chalk from "chalk";
import { listTemplates } from "../templates/index.ts";

/**
 * `sandbox templates` — List available templates.
 */
export function templatesCommand(): void {
  const templates = listTemplates();

  console.log(chalk.bold("\nAvailable templates:\n"));

  for (const t of templates) {
    console.log(`  ${chalk.cyan(t.name)}`);
    console.log(`    ${t.description}`);
    console.log(
      chalk.dim(
        `    Container services: ${t.services.container.map((s) => s.name).join(", ") || "(none)"}`
      )
    );
    console.log(
      chalk.dim(
        `    Host services: ${t.services.host.map((s) => s.name).join(", ") || "(none)"}`
      )
    );
    console.log(
      chalk.dim(`    Ports: ${t.ports.join(", ") || "(none)"}`)
    );
    console.log(
      chalk.dim(
        `    MCPs: ${Object.keys(t.mcp).join(", ") || "(none)"}`
      )
    );
    console.log("");
  }
}
