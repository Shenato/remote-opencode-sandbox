// ─── Core Types for remote-opencode-sandbox ───────────────────────────────

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
}

/** Docker image configuration */
export interface DockerConfig {
  baseImage: string;
  installChrome: boolean;
  installBun: boolean;
  installSupabaseCli: boolean;
  extraPackages: string[];
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

/** MCP server configuration */
export interface McpServer {
  type: "local" | "remote";
  command?: string[];
  url?: string;
  enabled?: boolean;
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
}

export interface ResolvedProject {
  name: string;
  hostPath: string;
  workspacePath: string; // /workspace/<name>
  services: ServiceManifest;
  envOverrides: Record<string, string>;
}
