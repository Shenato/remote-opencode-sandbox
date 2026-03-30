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
} from "../types.ts";
import {
  CONFIG_DIR,
  INSTANCES_DIR,
  GLOBAL_CONFIG_PATH,
  DEFAULT_INSTANCE,
  CONTAINER_WORKSPACE,
  PROJECT_SANDBOX_FILE,
  DEFAULT_BASE_IMAGE,
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
  return path.join(instanceDir(instanceName), "projects", `${projectName}.json`);
}

export function loadProjectConfig(
  instanceName: string,
  projectName: string
): ProjectConfig | null {
  return readJson<ProjectConfig>(projectConfigPath(instanceName, projectName));
}

export function saveProjectConfig(
  instanceName: string,
  config: ProjectConfig
): void {
  writeJson(projectConfigPath(instanceName, config.name), config);
}

export function deleteProjectConfig(
  instanceName: string,
  projectName: string
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
  projectPath: string
): ProjectSandboxFile | null {
  return readJson<ProjectSandboxFile>(
    path.join(projectPath, PROJECT_SANDBOX_FILE)
  );
}

// ─── Instance Secrets (.env in instance dir) ───────────────────────────────

function instanceEnvPath(instanceName: string): string {
  return path.join(instanceDir(instanceName), "generated", ".env");
}

export function loadInstanceSecrets(
  instanceName: string
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
  secrets: Record<string, string>
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
  fs.writeFileSync(instanceEnvPath(instanceName), lines.join("\n") + "\n", "utf-8");
}

// ─── Config Resolution (merge all layers) ──────────────────────────────────

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
    const sandboxFile = loadProjectSandboxFile(proj.hostPath);
    if (sandboxFile?.docker?.extraPackages) {
      for (const pkg of sandboxFile.docker.extraPackages) {
        allExtraPackages.add(pkg);
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
    const sandboxFile = loadProjectSandboxFile(proj.hostPath);
    if (sandboxFile?.docker?.installSteps) {
      for (const step of sandboxFile.docker.installSteps) {
        installStepsByName.set(step.name, step);
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
    installSupabaseCli: instanceConfig.docker?.installSupabaseCli ?? needsSupabaseCli,
    extraPackages: Array.from(allExtraPackages),
    installSteps: allInstallSteps.length > 0 ? allInstallSteps : undefined,
  };

  // Merge MCP servers from all layers
  const mcp: Record<string, McpServer> = {};
  for (const proj of projects) {
    const template = loadBuiltinTemplate(proj.template);
    if (template?.mcp) Object.assign(mcp, template.mcp);
    if (proj.mcp) Object.assign(mcp, proj.mcp);
    const sandboxFile = loadProjectSandboxFile(proj.hostPath);
    if (sandboxFile?.mcp) Object.assign(mcp, sandboxFile.mcp);
  }
  if (instanceConfig.mcp) Object.assign(mcp, instanceConfig.mcp);

  // Merge env overrides
  const envOverrides: Record<string, string> = {};
  if (instanceConfig.envOverrides) Object.assign(envOverrides, instanceConfig.envOverrides);
  for (const proj of projects) {
    Object.assign(envOverrides, proj.envOverrides);
    const sandboxFile = loadProjectSandboxFile(proj.hostPath);
    if (sandboxFile?.env?.override) Object.assign(envOverrides, sandboxFile.env.override);
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

    // Merge services from template + project config + .sandbox.json
    const template = loadBuiltinTemplate(proj.template);
    const sandboxFile = loadProjectSandboxFile(proj.hostPath);

    const containerServices: ContainerService[] = [];
    const hostServices: HostService[] = [];

    // Template services (with workdir set to this project)
    if (template?.services.container) {
      for (const svc of template.services.container) {
        containerServices.push({ ...svc, workdir: svc.workdir ?? workspacePath });
      }
    }
    if (template?.services.host) {
      for (const svc of template.services.host) {
        hostServices.push({ ...svc, workdir: svc.workdir ?? proj.hostPath });
      }
    }

    // Project config services override/add to template
    if (proj.services.container) {
      for (const svc of proj.services.container) {
        const existing = containerServices.findIndex((s) => s.name === svc.name);
        const resolved = { ...svc, workdir: svc.workdir ?? workspacePath };
        if (existing >= 0) {
          containerServices[existing] = resolved;
        } else {
          containerServices.push(resolved);
        }
      }
    }
    if (proj.services.host) {
      for (const svc of proj.services.host) {
        const existing = hostServices.findIndex((s) => s.name === svc.name);
        const resolved = { ...svc, workdir: svc.workdir ?? proj.hostPath };
        if (existing >= 0) {
          hostServices[existing] = resolved;
        } else {
          hostServices.push(resolved);
        }
      }
    }

    // .sandbox.json services override/add
    if (sandboxFile?.services?.container) {
      for (const svc of sandboxFile.services.container) {
        const existing = containerServices.findIndex((s) => s.name === svc.name);
        const resolved = { ...svc, workdir: svc.workdir ?? workspacePath };
        if (existing >= 0) {
          containerServices[existing] = resolved;
        } else {
          containerServices.push(resolved);
        }
      }
    }
    if (sandboxFile?.services?.host) {
      for (const svc of sandboxFile.services.host) {
        const existing = hostServices.findIndex((s) => s.name === svc.name);
        const resolved = { ...svc, workdir: svc.workdir ?? proj.hostPath };
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
          d.includes(":") ? d : `${proj.name}:${d}`
        );
      }
    }
    for (const svc of hostServices) {
      svc.name = `${proj.name}:${svc.name}`;
      if (svc.dependsOn) {
        svc.dependsOn = svc.dependsOn.map((d) =>
          d.includes(":") ? d : `${proj.name}:${d}`
        );
      }
    }

    allContainerServices.push(...containerServices);
    allHostServices.push(...hostServices);

    resolvedProjects.push({
      name: proj.name,
      hostPath: proj.hostPath,
      workspacePath,
      services: { container: containerServices, host: hostServices },
      envOverrides: {
        ...proj.envOverrides,
        ...(sandboxFile?.env?.override ?? {}),
      },
    });
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
    const sandboxFile = loadProjectSandboxFile(proj.hostPath);
    if (sandboxFile?.ports) {
      for (const p of sandboxFile.ports) ports.add(p);
    }
  }

  // Determine permission level (most permissive wins)
  let permission: "allow" | "ask" = "ask";
  for (const proj of projects) {
    if (proj.permission === "allow") {
      permission = "allow";
      break;
    }
    const sandboxFile = loadProjectSandboxFile(proj.hostPath);
    if (sandboxFile?.permission === "allow") {
      permission = "allow";
      break;
    }
  }

  // Resolve SSH config (expand ~ to home dir, validate key exists)
  let ssh: SshConfig | undefined;
  if (globalConfig.ssh?.keyPath) {
    const expandedPath = globalConfig.ssh.keyPath.replace(
      /^~/,
      os.homedir()
    );
    if (fs.existsSync(expandedPath)) {
      ssh = {
        keyPath: expandedPath,
        githubUsername: globalConfig.ssh.githubUsername,
      };
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
    extraRepos: instanceConfig.extraRepos ?? [],
  };
}
