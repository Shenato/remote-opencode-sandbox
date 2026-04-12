// ─── Core Types for remote-opencode-sandbox ───────────────────────────────

/** SSH key configuration for git authentication */
export interface SshConfig {
  /** Path to the private key on the host (e.g., "~/.ssh/id_ed25519") */
  keyPath: string;
  /** Associated GitHub username (for git URL rewriting) */
  githubUsername?: string;
}

/** Global configuration stored at ~/.config/remote-opencode-sandbox/config.json */
export interface GlobalConfig {
  /** Discord bot token for remote-opencode */
  discordToken?: string;
  /** Default GitHub PAT (can be overridden per-project) */
  defaultGithubPat?: string;
  /** Git identity */
  git?: {
    name: string;
    email: string;
  };
  /** SSH key configuration for git operations */
  ssh?: SshConfig;
  /** Default instance name */
  defaultInstance: string;
}

/** An instance is a single Docker container that can host multiple projects */
export interface InstanceConfig {
  name: string;
  /** Projects in this instance (by project name) */
  projects: string[];
  /** Instance-level env overrides (apply to all projects in this instance) */
  envOverrides?: Record<string, string>;
  /** Instance-level extra packages to install in the Docker image */
  extraPackages?: string[];
  /** Instance-level MCP servers */
  mcp?: Record<string, McpServer>;
  /** Docker image settings */
  docker?: DockerConfig;
  /** Instance-level container services (not tied to any project) */
  services?: ContainerService[];
  /**
   * Extra repositories to clone into /workspace/ at container startup.
   *
   * These are repos created by the bot or added by the user that aren't
   * full "projects" (no template, no host bind mount). They live entirely
   * inside the container, persisted via named Docker volumes.
   *
   * Format: HTTPS GitHub URLs, e.g. "https://github.com/org/repo.git"
   * The repo is cloned into /workspace/<repo-name>/.
   * On subsequent starts, existing repos are pulled instead of cloned.
   */
  extraRepos?: string[];
  /** Multi-agent team configuration (worker/reviewer/planner on kanban boards) */
  agentTeam?: AgentTeamConfig;
}

/** Docker image configuration */
export interface DockerConfig {
  baseImage: string;
  installChrome: boolean;
  installBun: boolean;
  installSupabaseCli: boolean;
  extraPackages: string[];
  /** Custom install steps for arbitrary software (escape hatch for templates) */
  installSteps?: DockerInstallStep[];
}

/**
 * A custom Dockerfile install step.
 *
 * Templates use this to install arbitrary software without needing
 * changes to the core Dockerfile generator. Each step produces a
 * labelled block in the generated Dockerfile.
 */
export interface DockerInstallStep {
  /** Unique name for this step (used for merging across config layers) */
  name: string;
  /** Comment emitted above the block in the Dockerfile */
  comment?: string;
  /** Extra apt packages required by this step (merged into the main apt-get install) */
  aptPackages?: string[];
  /** Raw Dockerfile lines (RUN, ENV, COPY, etc.) emitted verbatim */
  instructions: string[];
  /** Which USER context to emit these instructions under (default: root) */
  user?: "root" | "coder";
  /**
   * Human-readable description of what this software does and how the bot
   * should use it. Included in the generated AGENTS.md so the AI agent
   * knows about installed tools. If omitted, the `comment` field is used.
   */
  description?: string;
}

/** A project registered in the sandbox */
export interface ProjectConfig {
  /** Project display name (derived from directory name) */
  name: string;
  /** Absolute path to the project on the host */
  hostPath: string;
  /** Which instance this project belongs to */
  instance: string;
  /** Template used (e.g., "web-supabase", "node-basic") */
  template: string;
  /** GitHub PAT for this project (or "default" to use global) */
  githubPat: string | "default";
  /** Services this project needs */
  services: ServiceManifest;
  /** Env var overrides (localhost → host.docker.internal, etc.) */
  envOverrides: Record<string, string>;
  /** Env var names to pass through from .env files as-is */
  envPassthrough: string[];
  /** Secret env var names (stored in instance .env, never in project) */
  envSecrets: string[];
  /** Port mappings ("host:container") */
  ports: string[];
  /** MCP servers for this project */
  mcp?: Record<string, McpServer>;
  /** OpenCode permission level */
  permission: "allow" | "ask";
  /** Per-project agent team overrides (serve port, cron, model overrides) */
  agentConfig?: ProjectAgentConfig;
}

/** Project-level .sandbox.json that lives in the repo */
export interface ProjectSandboxFile {
  template?: string;
  services?: ServiceManifest;
  env?: {
    override?: Record<string, string>;
    passthrough?: string[];
    secrets?: string[];
  };
  ports?: string[];
  mcp?: Record<string, McpServer>;
  permission?: "allow" | "ask";
  docker?: Partial<DockerConfig>;
}

/** Services manifest for a project */
export interface ServiceManifest {
  /** Services that run inside the container */
  container: ContainerService[];
  /** Services that run on the host */
  host: HostService[];
}

/** A service running inside the Docker container */
export interface ContainerService {
  name: string;
  command: string;
  /** Working directory inside the container (auto-set to /workspace/<project>) */
  workdir?: string;
  /** Port this service listens on */
  port?: number;
  /** Service type */
  type: "daemon" | "oneshot";
  /** Restart policy for daemons */
  restart: "always" | "on-failure" | "never";
  /** Names of services that must complete/start before this one */
  dependsOn?: string[];
  /** Extra env vars for this service only */
  env?: Record<string, string>;
}

/** A service running on the host machine */
export interface HostService {
  name: string;
  /** Command to start the service */
  start: string;
  /** Command to stop the service */
  stop: string;
  /** Working directory on the host */
  workdir?: string;
  /** Health check command */
  healthCheck?: string;
  /** Service type */
  type: "daemon" | "oneshot";
  /** Names of services that must complete before this one */
  dependsOn?: string[];
}

// ─── Agent Team Types ──────────────────────────────────────────────────────

/**
 * Instance-level agent team configuration.
 *
 * When enabled, the sandbox generates a multi-agent system with worker,
 * reviewer, and planner agents that operate on per-project kanban boards.
 * A user-provided toolkit repo (e.g. `agents-setup`) supplies the CLI
 * that orchestrates cron loops, board management, and Discord notifications.
 */
export interface AgentTeamConfig {
  /** Master switch — generates agent infrastructure when true */
  enabled: boolean;
  /**
   * Git URL of the toolkit repo (HTTPS or SSH).
   *
   * This is NOT treated as a regular extraRepo — it is a first-class entity:
   * 1. Cloned into /workspace/<repo-name>/
   * 2. Symlinked to /workspace/.toolkit for workspace-root discoverability
   * 3. `bun install` is run in it
   * 4. Its `setup` command creates /workspace/.agents/ (skills, workspace config)
   * 5. Its `init` command scaffolds per-project .agents/ dirs
   *
   * Must expose a CLI at `bin/cli.ts` with commands: setup, init, work, review, plan, daemon.
   */
  toolkitRepo?: string;
  /** Default model for the worker agent (can be overridden per-project) */
  workerModel?: string;
  /** Default model for the reviewer agent (can be overridden per-project) */
  reviewerModel?: string;
  /** Default model for the planner agent (can be overridden per-project) */
  plannerModel?: string;
  /** Max steps for the worker agent per run */
  workerSteps?: number;
  /** Max steps for the reviewer agent per run */
  reviewerSteps?: number;
  /** Max steps for the planner agent per run */
  plannerSteps?: number;
  /** Minutes between worker cron runs (default: 30) */
  workerIntervalMinutes?: number;
  /** Minutes between reviewer cron runs (default: 60) */
  reviewerIntervalMinutes?: number;
  /** Hard timeout in seconds for each agent run (default: 300) */
  runTimeoutSeconds?: number;
  /** Discord notification settings for agent activity */
  discord?: AgentDiscordConfig;
  /**
   * Agent configs for repos that aren't full projects (e.g. repos in `extraRepos`).
   *
   * Keyed by repo name (the directory name under /workspace/, e.g. "sand-surfer").
   * These repos get the same agent services (opencode-serve, agents-init, agents-daemon)
   * as full projects, but they aren't bind-mounted from the host — they live inside
   * the container volume.
   */
  repoAgentConfigs?: Record<string, ProjectAgentConfig>;
}

/** Discord notification config for the agent team */
export interface AgentDiscordConfig {
  /** Whether agents should send Discord notifications (default: true when agent team enabled) */
  enabled?: boolean;
  /**
   * Discord channel name suffix for notifications.
   * Agents look for a channel named "<project-name>-<suffix>" or fall back to "<project-name>".
   * Default: "dev"
   */
  channelSuffix?: string;
}

/**
 * Per-project agent overrides stored in ProjectConfig.
 *
 * These let individual projects customize their agent behaviour
 * (different models, disable cron, change serve port) without
 * affecting other projects in the same instance.
 */
export interface ProjectAgentConfig {
  /** Port for `opencode serve` for this project (must be unique per instance) */
  servePort: number;
  /** Whether the cron daemon runs for this project (default: false) */
  cronEnabled?: boolean;
  /** Override the worker model for this project */
  workerModel?: string;
  /** Override the reviewer model for this project */
  reviewerModel?: string;
  /** Override the planner model for this project */
  plannerModel?: string;
}

/** Fully resolved per-project agent config (all defaults applied) */
export interface ResolvedProjectAgentConfig {
  servePort: number;
  /** Port for daemon's separate opencode serve (servePort + offset). Only set when cronEnabled. */
  daemonPort?: number;
  /** Path to the git worktree for daemon agents. Only set when cronEnabled. */
  worktreePath?: string;
  cronEnabled: boolean;
  workerModel: string;
  reviewerModel: string;
  plannerModel: string;
  workerSteps: number;
  reviewerSteps: number;
  plannerSteps: number;
  workerIntervalMinutes: number;
  reviewerIntervalMinutes: number;
  runTimeoutSeconds: number;
}

/** Fully resolved instance-level agent team config */
export interface ResolvedAgentTeamConfig {
  enabled: boolean;
  /** Name derived from the toolkit repo URL (e.g. "agents-setup") */
  toolkitName: string;
  /** Full git URL of the toolkit repo */
  toolkitRepo: string;
  /** Actual clone path inside the container: /workspace/<toolkitName> */
  toolkitPath: string;
  /** Symlink path at workspace root: /workspace/.toolkit */
  toolkitSymlinkPath: string;
  /** Discord notification settings */
  discord: { enabled: boolean; channelSuffix: string };
  /** Per-project resolved configs, keyed by project name (includes both projects and extra repos) */
  projects: Record<string, ResolvedProjectAgentConfig>;
}

/** MCP server configuration */
export interface McpServer {
  type: "local" | "remote";
  command?: string[];
  url?: string;
  enabled?: boolean;
  /** Environment variables passed to this MCP server process */
  environment?: Record<string, string>;
}

/** Template definition */
export interface Template {
  name: string;
  description: string;
  /** Docker image settings */
  docker: DockerConfig;
  /** Default services */
  services: ServiceManifest;
  /** Default env overrides */
  envOverrides: Record<string, string>;
  /** Env rewrite rules for auto-detection */
  envRewriteRules: EnvRewriteRule[];
  /** Default MCP servers */
  mcp: Record<string, McpServer>;
  /** Default port mappings */
  ports: string[];
  /** Default permission level */
  permission: "allow" | "ask";
  /** Default extra env var names to prompt as secrets */
  defaultSecrets: string[];
  /** Default agent team configuration (disabled by default) */
  agentTeam?: AgentTeamConfig;
}

/** Rule for automatically rewriting env vars for container use */
export interface EnvRewriteRule {
  /** Regex pattern to match in env var values */
  pattern: string;
  /** Replacement string */
  replace: string;
  /** Human-readable description */
  description: string;
}

/** Resolved/merged configuration ready for generation */
export interface ResolvedInstance {
  name: string;
  projects: ResolvedProject[];
  docker: DockerConfig;
  mcp: Record<string, McpServer>;
  /** All container services across all projects */
  allContainerServices: ContainerService[];
  /** All host services across all projects */
  allHostServices: HostService[];
  /** Merged env overrides */
  envOverrides: Record<string, string>;
  /** Merged secrets */
  envSecrets: Record<string, string>;
  /** All port mappings */
  ports: string[];
  /** Permission level (most permissive wins) */
  permission: "allow" | "ask";
  /** SSH key configuration (resolved from global config) */
  ssh?: SshConfig;
  /** Extra repos to clone/pull at container startup */
  extraRepos: string[];
  /** Resolved agent team config (undefined when agent team disabled) */
  agentTeam?: ResolvedAgentTeamConfig;
}

export interface ResolvedProject {
  name: string;
  hostPath: string;
  workspacePath: string; // /workspace/<name>
  services: ServiceManifest;
  envOverrides: Record<string, string>;
  /** Resolved agent config for this project (undefined when agent team disabled) */
  agentConfig?: ResolvedProjectAgentConfig;
}
