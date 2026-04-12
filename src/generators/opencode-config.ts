import type { ResolvedInstance, ResolvedAgentTeamConfig } from "../types.ts";

/**
 * Generate the opencode.docker.json config for the container.
 *
 * This is loaded via OPENCODE_CONFIG env var inside the container.
 * It merges with whatever project-level opencode.jsonc exists.
 */
export function generateOpenCodeConfig(instance: ResolvedInstance): string {
  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    permission: instance.permission,
    mcp: instance.mcp,
    // Point OpenCode to the workspace-level AGENTS.md so the bot
    // always knows about its environment, installed tools, and MCPs
    instructions: ["/workspace/AGENTS.md"],
  };

  // When agent team is enabled, inject agent definitions and slash commands
  if (instance.agentTeam?.enabled) {
    const agentDefs = generateAgentDefinitions(instance.agentTeam);
    config.agent = agentDefs.agent;
    config.command = agentDefs.command;
  }

  return JSON.stringify(config, null, 2) + "\n";
}

// ─── Agent Definitions ─────────────────────────────────────────────────────

interface AgentDef {
  name: string;
  model?: string;
  maxSteps?: number;
  prompt: string;
}

interface CommandDef {
  name: string;
  template: string;
  description?: string;
}

function generateAgentDefinitions(agentTeam: ResolvedAgentTeamConfig): {
  agent: Record<string, Omit<AgentDef, "name">>;
  command: Record<string, Omit<CommandDef, "name">>;
} {
  // Use the symlink path — canonical way to reference the toolkit from workspace root
  const toolkitPath = agentTeam.toolkitSymlinkPath;

  // Project list for embedding in prompts
  const projectEntries = Object.entries(agentTeam.projects);
  const projectList = projectEntries
    .map(([name, cfg]) => `  - ${name} (port ${cfg.servePort}, cron: ${cfg.cronEnabled})`)
    .join("\n");

  // ── Agent definitions ──

  const workerPrompt = [
    `You are the kanban-worker agent. Your job is to pick up tasks from the kanban board and implement them.`,
    ``,
    `IMPORTANT: Before doing anything, read the skill document at ${toolkitPath}/SKILL.md for the Discord notification protocol.`,
    `Then read the project-specific worker instructions at .agents/worker.md in the current project.`,
    ``,
    `Projects in this workspace:`,
    projectList,
    ``,
    `Workflow:`,
    `1. Read the kanban board to find the highest priority "todo" item`,
    `2. Move it to "in_progress" and assign it to yourself`,
    `3. Send a Discord notification that you picked up the task`,
    `4. Create a branch and implement the changes`,
    `5. Move the item to "done" (or "in_review" if reviewer is configured)`,
    `6. Send a Discord notification with a summary of what you did`,
    `7. Commit and push your changes`,
  ].join("\n");

  const reviewerPrompt = [
    `You are the kanban-reviewer agent. Your job is to review completed work on the kanban board.`,
    ``,
    `IMPORTANT: Before doing anything, read the skill document at ${toolkitPath}/SKILL.md for the Discord notification protocol.`,
    `Then read the project-specific reviewer instructions at .agents/reviewer.md in the current project.`,
    ``,
    `Projects in this workspace:`,
    projectList,
    ``,
    `Workflow:`,
    `1. Read the kanban board to find items in "in_review" or "done" status`,
    `2. Review the changes (check the branch, read the diff, run tests if applicable)`,
    `3. Send a Discord notification that you are reviewing the task`,
    `4. If approved: merge the feature branch into main (use git merge --no-ff), mark the item as "approved"`,
    `5. If rejected: move to "rejected" with clear feedback on what needs fixing`,
    `6. Push main after merging, delete the merged feature branch`,
    `7. Send a Discord notification with review results`,
  ].join("\n");

  const plannerPrompt = [
    `You are the kanban-planner agent. Your job is to break down high-level goals into actionable kanban tasks.`,
    ``,
    `IMPORTANT: Before doing anything, read the skill document at ${toolkitPath}/SKILL.md for the Discord notification protocol.`,
    `Then read the project-specific planner instructions at .agents/planner.md in the current project.`,
    ``,
    `Projects in this workspace:`,
    projectList,
    ``,
    `Workflow:`,
    `1. Read the current kanban board to understand existing work`,
    `2. Analyze the request or goal provided`,
    `3. Break it down into specific, implementable tasks with clear descriptions`,
    `4. Add tasks to the correct project's kanban board with appropriate priority`,
    `5. Send a Discord notification summarizing the planned tasks`,
  ].join("\n");

  const agents: Record<string, Omit<AgentDef, "name">> = {
    "kanban-worker": { prompt: workerPrompt },
    "kanban-reviewer": { prompt: reviewerPrompt },
    "kanban-planner": { prompt: plannerPrompt },
  };

  // ── Slash commands ──

  const commands: Record<string, Omit<CommandDef, "name">> = {
    "kanban-add": {
      description: "Add a new task to a project's kanban board",
      template: [
        `Add a new task to the kanban board. The user will provide the task details.`,
        `Use the agents-setup CLI: cd <project> && bun run ${toolkitPath}/bin/cli.ts add "<title>" --description "<desc>" --priority <priority>`,
        `If no project is specified, ask which project this task belongs to.`,
        `Available projects:`,
        projectList,
      ].join("\n"),
    },
    "kanban-work": {
      description: "Trigger the worker agent on a project",
      template: [
        `Trigger the worker agent to pick up and complete the next task.`,
        `Use the agents-setup CLI: bun run ${toolkitPath}/bin/cli.ts work --project <project> --port <port>`,
        `If no project is specified, show the kanban boards and ask which project to work on.`,
        `Available projects:`,
        projectList,
      ].join("\n"),
    },
    "kanban-review": {
      description: "Trigger the reviewer agent on a project",
      template: [
        `Trigger the reviewer agent to review completed work.`,
        `Use the agents-setup CLI: bun run ${toolkitPath}/bin/cli.ts review --project <project> --port <port>`,
        `If no project is specified, show items pending review and ask which project.`,
        `Available projects:`,
        projectList,
      ].join("\n"),
    },
    "kanban-status": {
      description: "Show kanban board status for projects",
      template: [
        `Show the current kanban board status for one or all projects.`,
        `Use the agents-setup CLI: bun run ${toolkitPath}/bin/cli.ts status --project <project>`,
        `If no project is specified, show all project boards.`,
        `Available projects:`,
        projectList,
      ].join("\n"),
    },
    "discord-notify": {
      description: "Send a Discord notification for a project",
      template: [
        `Send a Discord notification message for a project.`,
        `Use the agents-setup CLI: bun run ${toolkitPath}/bin/cli.ts notify --project <project> --message "<message>"`,
        `Available projects:`,
        projectList,
      ].join("\n"),
    },
    "discord-upload": {
      description: "Upload a file to a project's Discord channel",
      template: [
        `Upload a file to the project's Discord channel.`,
        `Use the agents-setup CLI: bun run ${toolkitPath}/bin/cli.ts discord-upload --project <project> --file <path>`,
        `Available projects:`,
        projectList,
      ].join("\n"),
    },
  };

  return { agent: agents, command: commands };
}
