import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  GlobalConfig,
  InstanceConfig,
  ProjectConfig,
  ProjectSandboxFile,
  Template,
  ResolvedInstance,
  ResolvedProject,
  DockerConfig,
  DockerInstallStep,
  McpServer,
  ContainerService,
  HostService,
  SshConfig,
  AgentTeamConfig,
  ResolvedAgentTeamConfig,
  ResolvedProjectAgentConfig,
  ResolvedToolkitConfig,
  ToolkitType,
} from "../types.ts";
import {
  CONFIG_DIR,
  INSTANCES_DIR,
  GLOBAL_CONFIG_PATH,
  DEFAULT_INSTANCE,
  CONTAINER_WORKSPACE,
  PROJECT_SANDBOX_FILE,
  DEFAULT_BASE_IMAGE,
  TOOLKIT_SYMLINK_NAME,
  AGENT_DEFAULT_WORKER_MODEL,
  AGENT_DEFAULT_REVIEWER_MODEL,
  AGENT_DEFAULT_PLANNER_MODEL,
  AGENT_DEFAULT_WORKER_STEPS,
  AGENT_DEFAULT_REVIEWER_STEPS,
  AGENT_DEFAULT_PLANNER_STEPS,
  AGENT_DEFAULT_WORKER_INTERVAL,
  AGENT_DEFAULT_REVIEWER_INTERVAL,
  AGENT_DEFAULT_RUN_TIMEOUT,
  AGENT_DEFAULT_SERVE_PORT_BASE,
  AGENT_DEFAULT_DISCORD_CHANNEL_SUFFIX,
  CONTAINER_WORKTREES_DIR,
  DAEMON_PORT_OFFSET,
} from "../constants.ts";
import { loadBuiltinTemplate } from "../templates/index.ts";

// ─── Filesystem Helpers ────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ─── Global Config ─────────────────────────────────────────────────────────

export function loadGlobalConfig(): GlobalConfig {
  const config = readJson<GlobalConfig>(GLOBAL_CONFIG_PATH);
  return config ?? { defaultInstance: DEFAULT_INSTANCE };
}

export function saveGlobalConfig(config: GlobalConfig): void {
  writeJson(GLOBAL_CONFIG_PATH, config);
}

export function isInitialized(): boolean {
  return fs.existsSync(GLOBAL_CONFIG_PATH);
}

// ─── Instance Config ───────────────────────────────────────────────────────

function instanceDir(name: string): string {
  return path.join(INSTANCES_DIR, name);
}

function instanceConfigPath(name: string): string {
  return path.join(instanceDir(name), "instance.json");
}

export function instanceGeneratedDir(name: string): string {
  return path.join(instanceDir(name), "generated");
}

export function loadInstanceConfig(name: string): InstanceConfig | null {
  return readJson<InstanceConfig>(instanceConfigPath(name));
}

export function saveInstanceConfig(config: InstanceConfig): void {
  writeJson(instanceConfigPath(config.name), config);
}

export function listInstances(): string[] {
  try {
    return fs
      .readdirSync(INSTANCES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

export function instanceExists(name: string): boolean {
  return fs.existsSync(instanceConfigPath(name));
}

export function createInstance(name: string): InstanceConfig {
  const config: InstanceConfig = {
    name,
    projects: [],
  };
  saveInstanceConfig(config);
  return config;
}

export function deleteInstance(name: string): void {
  const dir = instanceDir(name);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
}

// ─── Project Config ────────────────────────────────────────────────────────

function projectConfigPath(instanceName: string, projectName: string): string {
  return path.join(
    instanceDir(instanceName),
    "projects",
    `${projectName}.json`,
  );
}

export function loadProjectConfig(
  instanceName: string,
  projectName: string,
): ProjectConfig | null {
  return readJson<ProjectConfig>(projectConfigPath(instanceName, projectName));
}

export function saveProjectConfig(
  instanceName: string,
  config: ProjectConfig,
): void {
  writeJson(projectConfigPath(instanceName, config.name), config);
}

export function deleteProjectConfig(
  instanceName: string,
  projectName: string,
): void {
  const p = projectConfigPath(instanceName, projectName);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function listProjectsInInstance(instanceName: string): ProjectConfig[] {
  const dir = path.join(instanceDir(instanceName), "projects");
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<ProjectConfig>(path.join(dir, f)))
      .filter((c): c is ProjectConfig => c !== null);
  } catch {
    return [];
  }
}

// ─── Project Sandbox File (.sandbox.json in repo) ──────────────────────────

export function loadProjectSandboxFile(
  projectPath: string,
): ProjectSandboxFile | null {
  return readJson<ProjectSandboxFile>(
    path.join(projectPath, PROJECT_SANDBOX_FILE),
  );
}

// ─── Instance Secrets (.env in instance dir) ───────────────────────────────

function instanceEnvPath(instanceName: string): string {
  return path.join(instanceDir(instanceName), "generated", ".env");
}

/**
 * Path to the user-managed secrets.json file.
 * This file is NOT auto-generated — the user creates and edits it directly.
 * It stores secret values (API keys, tokens) separate from config.
 * Format: { "SECRET_NAME": "secret_value", ... }
 */
function instanceSecretsJsonPath(instanceName: string): string {
  return path.join(instanceDir(instanceName), "secrets.json");
}

export function loadSecretsJson(
  instanceName: string,
): Record<string, string> {
  return readJson<Record<string, string>>(instanceSecretsJsonPath(instanceName)) ?? {};
}

export function saveSecretsJson(
  instanceName: string,
  secrets: Record<string, string>,
): void {
  writeJson(instanceSecretsJsonPath(instanceName), secrets);
}

export function loadInstanceSecrets(
  instanceName: string,
): Record<string, string> {
  // Merge: secrets.json (user-managed) takes precedence over existing generated .env
  const fromEnv = loadGeneratedEnv(instanceName);
  const fromJson = loadSecretsJson(instanceName);
  return { ...fromEnv, ...fromJson };
}

/**
 * Load secrets from the generated .env file (legacy / auto-generated values).
 */
function loadGeneratedEnv(
  instanceName: string,
): Record<string, string> {
  try {
    const raw = fs.readFileSync(instanceEnvPath(instanceName), "utf-8");
    const secrets: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      const val = trimmed.slice(eqIdx + 1);
      secrets[key] = val;
    }
    return secrets;
  } catch {
    return {};
  }
}

export function saveInstanceSecrets(
  instanceName: string,
  secrets: Record<string, string>,
): void {
  const dir = path.join(instanceDir(instanceName), "generated");
  ensureDir(dir);
  const lines = [
    "# Auto-generated by remote-opencode-sandbox",
    "# Secrets for instance: " + instanceName,
    "# Do NOT commit this file.",
    "",
  ];
  for (const [key, value] of Object.entries(secrets)) {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(
    instanceEnvPath(instanceName),
    lines.join("\n") + "\n",
    "utf-8",
  );
}

// ─── Config Resolution (merge all layers) ──────────────────────────────────

/**
 * Extract the repository name from an HTTPS git URL.
 * e.g. "https://github.com/org/agents-setup.git" → "agents-setup"
 */
function repoNameFromUrl(url: string): string {
  const lastSegment = url.split("/").pop() ?? url;
  return lastSegment.replace(/\.git$/, "");
}

/**
 * Resolve agent team config by merging instance-level defaults with
 * per-project overrides and extra-repo agent configs.
 * Returns undefined when the agent team is disabled.
 */
function resolveAgentTeam(
  instanceConfig: InstanceConfig,
  projects: ProjectConfig[],
): ResolvedAgentTeamConfig | undefined {
  const agentTeam = instanceConfig.agentTeam;
  if (!agentTeam?.enabled || !agentTeam.toolkitRepo) return undefined;

  const defaultToolkitName = repoNameFromUrl(agentTeam.toolkitRepo);
  const defaultToolkitPath = `${CONTAINER_WORKSPACE}/${defaultToolkitName}`;
  const toolkitSymlinkPath = `${CONTAINER_WORKSPACE}/${TOOLKIT_SYMLINK_NAME}`;

  // Build set of all project names for detecting project-toolkits
  const projectNames = new Set(projects.map((p) => p.name));
  // Also include extra repo names from repoAgentConfigs
  if (agentTeam.repoAgentConfigs) {
    for (const name of Object.keys(agentTeam.repoAgentConfigs)) {
      projectNames.add(name);
    }
  }

  const defaultToolkitType = agentTeam.toolkitType ?? "agents-setup";

  // Track all unique toolkits (keyed by name derived from URL)
  const toolkits: Record<string, ResolvedToolkitConfig> = {
    [defaultToolkitName]: {
      name: defaultToolkitName,
      repo: agentTeam.toolkitRepo,
      path: defaultToolkitPath,
      type: defaultToolkitType,
      isDefault: true,
      isProject: projectNames.has(defaultToolkitName),
    },
  };

  // Helper to resolve toolkit info for a project
  function resolveProjectToolkit(projAgent?: { toolkitRepo?: string; toolkitType?: ToolkitType }): {
    toolkitName: string;
    toolkitType: ToolkitType;
    toolkitPath: string;
    toolkitSymlinkPath: string;
  } {
    const projectToolkitRepo = projAgent?.toolkitRepo;
    if (!projectToolkitRepo || projectToolkitRepo === agentTeam!.toolkitRepo) {
      return {
        toolkitName: defaultToolkitName,
        toolkitType: projAgent?.toolkitType ?? defaultToolkitType,
        toolkitPath: defaultToolkitPath,
        toolkitSymlinkPath,
      };
    }
    const name = repoNameFromUrl(projectToolkitRepo);
    const path = `${CONTAINER_WORKSPACE}/${name}`;
    const type = projAgent?.toolkitType ?? "agents-setup";
    // Register toolkit if not already tracked
    if (!toolkits[name]) {
      toolkits[name] = {
        name,
        repo: projectToolkitRepo,
        path,
        type,
        isDefault: false,
        isProject: projectNames.has(name),
      };
    }
    // Non-default toolkits reference their own path directly (no symlink indirection)
    return { toolkitName: name, toolkitType: type, toolkitPath: path, toolkitSymlinkPath: path };
  }

  // Resolve per-project agent configs (bind-mounted projects)
  const resolvedProjects: Record<string, ResolvedProjectAgentConfig> = {};
  for (let i = 0; i < projects.length; i++) {
    const proj = projects[i]!;
    const projAgent = proj.agentConfig;
    const cronEnabled = projAgent?.cronEnabled ?? false;
    const servePort = projAgent?.servePort ?? AGENT_DEFAULT_SERVE_PORT_BASE + i;
    const tk = resolveProjectToolkit(projAgent);

    resolvedProjects[proj.name] = {
      servePort,
      daemonPort: cronEnabled ? servePort + DAEMON_PORT_OFFSET : undefined,
      worktreePath: cronEnabled
        ? `${CONTAINER_WORKTREES_DIR}/${proj.name}`
        : undefined,
      cronEnabled,
      toolkitName: tk.toolkitName,
      toolkitType: tk.toolkitType,
      toolkitPath: tk.toolkitPath,
      toolkitSymlinkPath: tk.toolkitSymlinkPath,
      workerModel:
        projAgent?.workerModel ??
        agentTeam.workerModel ??
        AGENT_DEFAULT_WORKER_MODEL,
      reviewerModel:
        projAgent?.reviewerModel ??
        agentTeam.reviewerModel ??
        AGENT_DEFAULT_REVIEWER_MODEL,
      plannerModel:
        projAgent?.plannerModel ??
        agentTeam.plannerModel ??
        AGENT_DEFAULT_PLANNER_MODEL,
      workerSteps: agentTeam.workerSteps ?? AGENT_DEFAULT_WORKER_STEPS,
      reviewerSteps: agentTeam.reviewerSteps ?? AGENT_DEFAULT_REVIEWER_STEPS,
      plannerSteps: agentTeam.plannerSteps ?? AGENT_DEFAULT_PLANNER_STEPS,
      workerIntervalMinutes:
        agentTeam.workerIntervalMinutes ?? AGENT_DEFAULT_WORKER_INTERVAL,
      reviewerIntervalMinutes:
        agentTeam.reviewerIntervalMinutes ?? AGENT_DEFAULT_REVIEWER_INTERVAL,
      runTimeoutSeconds:
        agentTeam.runTimeoutSeconds ?? AGENT_DEFAULT_RUN_TIMEOUT,
    };
  }

  // Resolve agent configs for extra repos (not bind-mounted, live in container volume)
  if (agentTeam.repoAgentConfigs) {
    const existingCount = projects.length;
    const repoEntries = Object.entries(agentTeam.repoAgentConfigs);
    for (let i = 0; i < repoEntries.length; i++) {
      const [repoName, repoAgent] = repoEntries[i]!;
      const cronEnabled = repoAgent.cronEnabled ?? false;
      const servePort =
        repoAgent.servePort ??
        AGENT_DEFAULT_SERVE_PORT_BASE + existingCount + i;
      const tk = resolveProjectToolkit(repoAgent);

      resolvedProjects[repoName] = {
        servePort,
        daemonPort: cronEnabled ? servePort + DAEMON_PORT_OFFSET : undefined,
        worktreePath: cronEnabled
          ? `${CONTAINER_WORKTREES_DIR}/${repoName}`
          : undefined,
        cronEnabled,
        toolkitName: tk.toolkitName,
        toolkitType: tk.toolkitType,
        toolkitPath: tk.toolkitPath,
        toolkitSymlinkPath: tk.toolkitSymlinkPath,
        workerModel:
          repoAgent.workerModel ??
          agentTeam.workerModel ??
          AGENT_DEFAULT_WORKER_MODEL,
        reviewerModel:
          repoAgent.reviewerModel ??
          agentTeam.reviewerModel ??
          AGENT_DEFAULT_REVIEWER_MODEL,
        plannerModel:
          repoAgent.plannerModel ??
          agentTeam.plannerModel ??
          AGENT_DEFAULT_PLANNER_MODEL,
        workerSteps: agentTeam.workerSteps ?? AGENT_DEFAULT_WORKER_STEPS,
        reviewerSteps: agentTeam.reviewerSteps ?? AGENT_DEFAULT_REVIEWER_STEPS,
        plannerSteps: agentTeam.plannerSteps ?? AGENT_DEFAULT_PLANNER_STEPS,
        workerIntervalMinutes:
          agentTeam.workerIntervalMinutes ?? AGENT_DEFAULT_WORKER_INTERVAL,
        reviewerIntervalMinutes:
          agentTeam.reviewerIntervalMinutes ?? AGENT_DEFAULT_REVIEWER_INTERVAL,
        runTimeoutSeconds:
          agentTeam.runTimeoutSeconds ?? AGENT_DEFAULT_RUN_TIMEOUT,
      };
    }
  }

  return {
    enabled: true,
    toolkitName: defaultToolkitName,
    toolkitRepo: agentTeam.toolkitRepo,
    toolkitPath: defaultToolkitPath,
    toolkitSymlinkPath,
    toolkits,
    discord: {
      enabled: agentTeam.discord?.enabled ?? true,
      channelSuffix:
        agentTeam.discord?.channelSuffix ??
        AGENT_DEFAULT_DISCORD_CHANNEL_SUFFIX,
    },
    projects: resolvedProjects,
  };
}

export function resolveInstance(instanceName: string): ResolvedInstance | null {
  const instanceConfig = loadInstanceConfig(instanceName);
  if (!instanceConfig) return null;

  const globalConfig = loadGlobalConfig();
  const projects = listProjectsInInstance(instanceName);

  if (projects.length === 0) {
    return null;
  }

  // Merge Docker config: start from first project's template, overlay instance
  const firstTemplate = loadBuiltinTemplate(projects[0]!.template);
  const baseDocker: DockerConfig = firstTemplate?.docker ?? {
    baseImage: DEFAULT_BASE_IMAGE,
    installChrome: true,
    installBun: true,
    installSupabaseCli: false,
    extraPackages: [],
  };

  // Merge extra packages from all projects and instance
  const allExtraPackages = new Set<string>(baseDocker.extraPackages);
  for (const proj of projects) {
    // Only load .sandbox.json for host-mounted projects
    if (proj.hostPath) {
      const sandboxFile = loadProjectSandboxFile(proj.hostPath);
      if (sandboxFile?.docker?.extraPackages) {
        for (const pkg of sandboxFile.docker.extraPackages) {
          allExtraPackages.add(pkg);
        }
      }
    }
  }
  if (instanceConfig.extraPackages) {
    for (const pkg of instanceConfig.extraPackages) {
      allExtraPackages.add(pkg);
    }
  }

  // Merge custom install steps from all projects and instance (by step name)
  const installStepsByName = new Map<string, DockerInstallStep>();
  // Start with base template's steps
  if (baseDocker.installSteps) {
    for (const step of baseDocker.installSteps) {
      installStepsByName.set(step.name, step);
    }
  }
  // Overlay steps from all projects' templates and .sandbox.json files
  for (const proj of projects) {
    const template = loadBuiltinTemplate(proj.template);
    if (template?.docker.installSteps) {
      for (const step of template.docker.installSteps) {
        installStepsByName.set(step.name, step);
      }
    }
    // Only load .sandbox.json for host-mounted projects
    if (proj.hostPath) {
      const sandboxFile = loadProjectSandboxFile(proj.hostPath);
      if (sandboxFile?.docker?.installSteps) {
        for (const step of sandboxFile.docker.installSteps) {
          installStepsByName.set(step.name, step);
        }
      }
    }
  }
  // Instance-level steps override everything
  if (instanceConfig.docker?.installSteps) {
    for (const step of instanceConfig.docker.installSteps) {
      installStepsByName.set(step.name, step);
    }
  }
  const allInstallSteps = Array.from(installStepsByName.values());

  // Should install Chrome if any template needs it
  const needsChrome = projects.some((p) => {
    const t = loadBuiltinTemplate(p.template);
    return t?.docker.installChrome ?? true;
  });

  // Should install Supabase CLI if any template needs it
  const needsSupabaseCli = projects.some((p) => {
    const t = loadBuiltinTemplate(p.template);
    return t?.docker.installSupabaseCli ?? false;
  });

  const docker: DockerConfig = {
    baseImage: instanceConfig.docker?.baseImage ?? baseDocker.baseImage,
    installChrome: instanceConfig.docker?.installChrome ?? needsChrome,
    installBun: instanceConfig.docker?.installBun ?? baseDocker.installBun,
    installSupabaseCli:
      instanceConfig.docker?.installSupabaseCli ?? needsSupabaseCli,
    extraPackages: Array.from(allExtraPackages),
    installSteps: allInstallSteps.length > 0 ? allInstallSteps : undefined,
  };

  // Merge MCP servers from all layers
  const mcp: Record<string, McpServer> = {};
  for (const proj of projects) {
    const template = loadBuiltinTemplate(proj.template);
    if (template?.mcp) Object.assign(mcp, template.mcp);
    if (proj.mcp) Object.assign(mcp, proj.mcp);
    if (proj.hostPath) {
      const sandboxFile = loadProjectSandboxFile(proj.hostPath);
      if (sandboxFile?.mcp) Object.assign(mcp, sandboxFile.mcp);
    }
  }
  if (instanceConfig.mcp) Object.assign(mcp, instanceConfig.mcp);

  // Merge env overrides from all layers (template → instance → project → .sandbox.json)
  const envOverrides: Record<string, string> = {};
  for (const proj of projects) {
    const template = loadBuiltinTemplate(proj.template);
    if (template?.envOverrides)
      Object.assign(envOverrides, template.envOverrides);
  }
  if (instanceConfig.envOverrides)
    Object.assign(envOverrides, instanceConfig.envOverrides);
  for (const proj of projects) {
    Object.assign(envOverrides, proj.envOverrides);
    if (proj.hostPath) {
      const sandboxFile = loadProjectSandboxFile(proj.hostPath);
      if (sandboxFile?.env?.override)
        Object.assign(envOverrides, sandboxFile.env.override);
    }
  }

  // Collect secrets
  const envSecrets: Record<string, string> = {};
  const storedSecrets = loadInstanceSecrets(instanceName);
  // Add git identity
  if (globalConfig.git) {
    envSecrets["GIT_AUTHOR_NAME"] = globalConfig.git.name;
    envSecrets["GIT_COMMITTER_NAME"] = globalConfig.git.name;
    envSecrets["GIT_AUTHOR_EMAIL"] = globalConfig.git.email;
    envSecrets["GIT_COMMITTER_EMAIL"] = globalConfig.git.email;
  }
  Object.assign(envSecrets, storedSecrets);

  // Collect all services
  const allContainerServices: ContainerService[] = [];
  const allHostServices: HostService[] = [];
  const resolvedProjects: ResolvedProject[] = [];

  for (const proj of projects) {
    const workspacePath = `${CONTAINER_WORKSPACE}/${proj.name}`;
    const isRemote = !proj.hostPath;

    // Merge services from template + project config + .sandbox.json
    const template = loadBuiltinTemplate(proj.template);
    const sandboxFile = proj.hostPath
      ? loadProjectSandboxFile(proj.hostPath)
      : null;

    const containerServices: ContainerService[] = [];
    const hostServices: HostService[] = [];

    // Template services (with workdir set to this project)
    if (template?.services.container) {
      for (const svc of template.services.container) {
        containerServices.push({
          ...svc,
          workdir: svc.workdir ?? workspacePath,
        });
      }
    }
    // Host services only apply to host-mounted projects
    if (!isRemote && template?.services.host) {
      for (const svc of template.services.host) {
        hostServices.push({ ...svc, workdir: svc.workdir ?? proj.hostPath! });
      }
    }

    // Project config services override/add to template
    if (proj.services.container) {
      for (const svc of proj.services.container) {
        const existing = containerServices.findIndex(
          (s) => s.name === svc.name,
        );
        const resolved = { ...svc, workdir: svc.workdir ?? workspacePath };
        if (existing >= 0) {
          containerServices[existing] = resolved;
        } else {
          containerServices.push(resolved);
        }
      }
    }
    // Host services from project config only for host-mounted projects
    if (!isRemote && proj.services.host) {
      for (const svc of proj.services.host) {
        const existing = hostServices.findIndex((s) => s.name === svc.name);
        const resolved = { ...svc, workdir: svc.workdir ?? proj.hostPath! };
        if (existing >= 0) {
          hostServices[existing] = resolved;
        } else {
          hostServices.push(resolved);
        }
      }
    }

    // .sandbox.json services override/add (only for host-mounted projects)
    if (sandboxFile?.services?.container) {
      for (const svc of sandboxFile.services.container) {
        const existing = containerServices.findIndex(
          (s) => s.name === svc.name,
        );
        const resolved = { ...svc, workdir: svc.workdir ?? workspacePath };
        if (existing >= 0) {
          containerServices[existing] = resolved;
        } else {
          containerServices.push(resolved);
        }
      }
    }
    if (!isRemote && sandboxFile?.services?.host) {
      for (const svc of sandboxFile.services.host) {
        const existing = hostServices.findIndex((s) => s.name === svc.name);
        const resolved = { ...svc, workdir: svc.workdir ?? proj.hostPath! };
        if (existing >= 0) {
          hostServices[existing] = resolved;
        } else {
          hostServices.push(resolved);
        }
      }
    }

    // Namespace service names to avoid collisions between projects
    for (const svc of containerServices) {
      svc.name = `${proj.name}:${svc.name}`;
      if (svc.dependsOn) {
        svc.dependsOn = svc.dependsOn.map((d) =>
          d.includes(":") ? d : `${proj.name}:${d}`,
        );
      }
    }
    for (const svc of hostServices) {
      svc.name = `${proj.name}:${svc.name}`;
      if (svc.dependsOn) {
        svc.dependsOn = svc.dependsOn.map((d) =>
          d.includes(":") ? d : `${proj.name}:${d}`,
        );
      }
    }

    allContainerServices.push(...containerServices);
    allHostServices.push(...hostServices);

    resolvedProjects.push({
      name: proj.name,
      hostPath: proj.hostPath,
      gitUrl: proj.gitUrl,
      isRemote,
      workspacePath,
      services: { container: containerServices, host: hostServices },
      envOverrides: proj.envOverrides ?? {},
    });
  }

  // ── Deduplicate shared singleton services (e.g. Xvfb) ──────────
  // When multiple projects define the same daemon (same command), collapse
  // them into a single instance-level service. This prevents conflicts like
  // two Xvfb processes fighting over the same display number.
  const singletonCandidates = ["xvfb"];
  for (const baseName of singletonCandidates) {
    const matching = allContainerServices.filter(
      (svc) => svc.name.endsWith(`:${baseName}`) && svc.type === "daemon",
    );
    if (matching.length > 1) {
      // Remove all per-project instances
      for (const svc of matching) {
        const idx = allContainerServices.indexOf(svc);
        if (idx >= 0) allContainerServices.splice(idx, 1);
      }
      // Add a single instance-level service using the first one's config
      const first = matching[0]!;
      allContainerServices.push({
        ...first,
        name: `instance:${baseName}`,
        workdir: CONTAINER_WORKSPACE,
      });
      // Rewrite any dependsOn references from project-scoped to instance-scoped
      for (const svc of allContainerServices) {
        if (svc.dependsOn) {
          svc.dependsOn = svc.dependsOn.map((d) =>
            matching.some((m) => m.name === d)
              ? `instance:${baseName}`
              : d,
          );
        }
      }
    }
  }

  // Instance-level container services (not tied to any project)
  if (instanceConfig.services) {
    for (const svc of instanceConfig.services) {
      const resolved: ContainerService = {
        ...svc,
        name: svc.name.includes(":") ? svc.name : `instance:${svc.name}`,
        workdir: svc.workdir ?? CONTAINER_WORKSPACE,
      };
      allContainerServices.push(resolved);
    }
  }

  // Collect all ports
  const ports = new Set<string>();
  for (const proj of projects) {
    for (const p of proj.ports) ports.add(p);
    if (proj.hostPath) {
      const sandboxFile = loadProjectSandboxFile(proj.hostPath);
      if (sandboxFile?.ports) {
        for (const p of sandboxFile.ports) ports.add(p);
      }
    }
  }

  // Determine permission level (most permissive wins)
  let permission: "allow" | "ask" = "ask";
  for (const proj of projects) {
    if (proj.permission === "allow") {
      permission = "allow";
      break;
    }
    if (proj.hostPath) {
      const sandboxFile = loadProjectSandboxFile(proj.hostPath);
      if (sandboxFile?.permission === "allow") {
        permission = "allow";
        break;
      }
    }
  }

  // Resolve SSH config (expand ~ to home dir, validate key exists)
  let ssh: SshConfig | undefined;
  if (globalConfig.ssh?.keyPath) {
    const expandedPath = globalConfig.ssh.keyPath.replace(/^~/, os.homedir());
    if (fs.existsSync(expandedPath)) {
      ssh = {
        keyPath: expandedPath,
        githubUsername: globalConfig.ssh.githubUsername,
      };
    }
  }

  // Resolve agent team config
  const agentTeam = resolveAgentTeam(instanceConfig, projects);

  // Attach resolved agent config to each project
  if (agentTeam) {
    for (const rp of resolvedProjects) {
      rp.agentConfig = agentTeam.projects[rp.name];
    }
  }

  // Inject agent team services when enabled
  const extraRepos = [...(instanceConfig.extraRepos ?? [])];
  if (agentTeam) {
    // The toolkit repo is NOT added to extraRepos — it gets its own dedicated
    // clone/symlink block in the entrypoint generator (first-class entity).

    // Per-toolkit install and setup services (one per unique toolkit)
    for (const tk of Object.values(agentTeam.toolkits)) {
      // Determine the install dependency for this toolkit
      let installDepName: string;

      if (tk.isProject) {
        // Toolkit is also a project — reuse the project's existing :install
        // oneshot instead of creating a duplicate install service.
        installDepName = `${tk.name}:install`;
      } else {
        // Standalone toolkit — create a dedicated install service
        installDepName = `instance:${tk.name}-install`;

        const toolkitInstallSvc: ContainerService = {
          name: installDepName,
          command: "bun install",
          workdir: tk.path,
          type: "oneshot",
          restart: "never",
        };
        allContainerServices.push(toolkitInstallSvc);

        // Projects with local file dependencies on the toolkit need their
        // install oneshots to run AFTER the toolkit is cloned and installed.
        for (const svc of allContainerServices) {
          if (svc.type === "oneshot" && svc.name.endsWith(":install")) {
            svc.dependsOn = svc.dependsOn ?? [];
            if (!svc.dependsOn.includes(installDepName)) {
              svc.dependsOn.push(installDepName);
            }
          }
        }
      }

      // agents-setup toolkits get a workspace-level setup oneshot
      // opencode-orchestrator toolkits don't need setup — they manage their own config
      if (tk.type === "agents-setup") {
        const setupSvcName = `instance:${tk.name}-setup`;
        const toolkitSetupSvc: ContainerService = {
          name: setupSvcName,
          command: `bun run ${tk.path}/bin/cli.ts setup`,
          workdir: CONTAINER_WORKSPACE,
          type: "oneshot",
          restart: "never",
          dependsOn: [installDepName],
        };
        allContainerServices.push(toolkitSetupSvc);
      }
    }

    // Per-project agent services (both bind-mounted projects and extra repos)
    for (const [projectName, projAgent] of Object.entries(agentTeam.projects)) {
      const workspacePath = `${CONTAINER_WORKSPACE}/${projectName}`;
      const tkInstallDep = agentTeam.toolkits[projAgent.toolkitName]?.isProject
        ? `${projAgent.toolkitName}:install`
        : `instance:${projAgent.toolkitName}-install`;

      if (projAgent.toolkitType === "opencode-orchestrator") {
        // ── opencode-orchestrator flow ──
        // 1. Register the project in the orchestrator's config
        // 2. Start opencode serve for this project
        // 3. Run the orchestrator's server.ts as daemon (only when cronEnabled)

        // Oneshot: register project in orchestrator config
        const registerSvc: ContainerService = {
          name: `${projectName}:orchestrator-register`,
          command: [
            `bun run ${projAgent.toolkitPath}/src/cli.ts project add`,
            `${projectName} ${workspacePath}`,
            `--name "${projectName}"`,
            `--port ${projAgent.servePort}`,
            `--type game`,
          ].join(" "),
          workdir: projAgent.toolkitPath,
          type: "oneshot",
          restart: "never",
          dependsOn: [tkInstallDep],
        };
        allContainerServices.push(registerSvc);

        // Daemon: opencode serve for this project
        const serveSvc: ContainerService = {
          name: `${projectName}:opencode-serve`,
          command: `opencode serve --port ${projAgent.servePort}`,
          workdir: workspacePath,
          type: "daemon",
          restart: "always",
          port: projAgent.servePort,
          dependsOn: [`${projectName}:orchestrator-register`],
        };
        allContainerServices.push(serveSvc);

        // Daemon: orchestrator server (only when cronEnabled)
        // The server.ts has its own cron schedule — no worktree isolation needed
        // because the orchestrator dispatches via opencode run --attach which
        // runs in the opencode serve context, not directly in the filesystem.
        if (projAgent.cronEnabled) {
          const daemonSvc: ContainerService = {
            name: `${projectName}:orchestrator-server`,
            command: `bun run ${projAgent.toolkitPath}/src/server.ts`,
            workdir: projAgent.toolkitPath,
            type: "daemon",
            restart: "always",
            env: {
              ACTIVE_PROJECT: projectName,
              PROJECT_ROOT: workspacePath,
              CONFIG_FILE: `${projAgent.toolkitPath}/data/${projectName}-config.json`,
            },
            dependsOn: [`${projectName}:opencode-serve`],
          };
          allContainerServices.push(daemonSvc);
        }
      } else {
        // ── agents-setup flow (default) ──
        const tkSetupSvc = `instance:${projAgent.toolkitName}-setup`;

        // Oneshot: toolkit init (scaffolds per-project .agents/ directory)
        const initSvc: ContainerService = {
          name: `${projectName}:agents-init`,
          command: `bun run ${projAgent.toolkitSymlinkPath}/bin/cli.ts init --port ${projAgent.servePort}`,
          workdir: workspacePath,
          type: "oneshot",
          restart: "never",
          dependsOn: [tkSetupSvc],
        };
        allContainerServices.push(initSvc);

        // Daemon: opencode serve for this project
        const serveSvc: ContainerService = {
          name: `${projectName}:opencode-serve`,
          command: `opencode serve --port ${projAgent.servePort}`,
          workdir: workspacePath,
          type: "daemon",
          restart: "always",
          port: projAgent.servePort,
          dependsOn: [`${projectName}:agents-init`],
        };
        allContainerServices.push(serveSvc);

        // Daemon: toolkit cron daemon (only when cronEnabled)
        // Uses git worktree isolation so daemon agents don't conflict with
        // interactive Discord-prompted work on the same project.
        if (projAgent.cronEnabled) {
          const worktreePath = `${CONTAINER_WORKTREES_DIR}/${projectName}`;
          const daemonPort = projAgent.servePort + DAEMON_PORT_OFFSET;

          // Oneshot: create git worktree (detached HEAD, fresh each container start)
          const worktreeCreateSvc: ContainerService = {
            name: `${projectName}:worktree-create`,
            command: `rm -rf ${worktreePath} && git worktree prune && git worktree add --detach ${worktreePath}`,
            workdir: workspacePath,
            type: "oneshot",
            restart: "never",
          };
          allContainerServices.push(worktreeCreateSvc);

          // Oneshot: init agent config in worktree (with daemon port)
          const worktreeInitSvc: ContainerService = {
            name: `${projectName}:worktree-init`,
            command: `bun run ${projAgent.toolkitSymlinkPath}/bin/cli.ts init --port ${daemonPort} --cronEnabled`,
            workdir: worktreePath,
            type: "oneshot",
            restart: "never",
            dependsOn: [
              `${projectName}:worktree-create`,
              tkSetupSvc,
            ],
          };
          allContainerServices.push(worktreeInitSvc);

          // Daemon: opencode serve in worktree (daemon port, separate from main serve)
          const daemonServeSvc: ContainerService = {
            name: `${projectName}:daemon-serve`,
            command: `opencode serve --port ${daemonPort}`,
            workdir: worktreePath,
            type: "daemon",
            restart: "always",
            port: daemonPort,
            dependsOn: [`${projectName}:worktree-init`],
          };
          allContainerServices.push(daemonServeSvc);

          // Daemon: toolkit cron daemon (runs from worktree, connects to daemon-serve)
          const daemonSvc: ContainerService = {
            name: `${projectName}:agents-daemon`,
            command: `bun run ${projAgent.toolkitSymlinkPath}/bin/cli.ts daemon --project ${projectName} --port ${daemonPort}`,
            workdir: worktreePath,
            type: "daemon",
            restart: "always",
            dependsOn: [`${projectName}:daemon-serve`],
          };
          allContainerServices.push(daemonSvc);
        }
      }
    }
  }

  return {
    name: instanceName,
    projects: resolvedProjects,
    docker,
    mcp,
    allContainerServices,
    allHostServices,
    envOverrides,
    envSecrets,
    ports: Array.from(ports),
    permission,
    ssh,
    extraRepos,
    agentTeam,
  };
}
