import fs from "node:fs";
import path from "node:path";
import {
  resolveInstance,
  instanceGeneratedDir,
  saveInstanceSecrets,
  loadInstanceSecrets,
  loadGlobalConfig,
  listProjectsInInstance,
} from "../config/manager.ts";
import {
  generateDockerfile,
  generateCompose,
  generateEntrypoint,
  generateOpenCodeConfig,
  generateGitCredentials,
} from "../generators/index.ts";

/**
 * Build (generate) all Docker files for an instance.
 * This reads the resolved config and writes:
 *   - Dockerfile
 *   - docker-compose.yml
 *   - docker-entrypoint.sh
 *   - opencode.docker.json
 *   - .env (secrets)
 */
export function buildInstance(instanceName: string): {
  success: boolean;
  generatedDir: string;
  error?: string;
} {
  const resolved = resolveInstance(instanceName);
  const genDir = instanceGeneratedDir(instanceName);

  if (!resolved) {
    return {
      success: false,
      generatedDir: genDir,
      error: `Instance "${instanceName}" has no projects or does not exist.`,
    };
  }

  // Ensure generated directory exists
  fs.mkdirSync(genDir, { recursive: true });

  // Generate all files
  const dockerfile = generateDockerfile(resolved);
  const compose = generateCompose(resolved);
  const entrypoint = generateEntrypoint(resolved);
  const opencodeConfig = generateOpenCodeConfig(resolved);

  // Write them
  fs.writeFileSync(path.join(genDir, "Dockerfile"), dockerfile, "utf-8");
  fs.writeFileSync(path.join(genDir, "docker-compose.yml"), compose, "utf-8");
  fs.writeFileSync(path.join(genDir, "docker-entrypoint.sh"), entrypoint, {
    encoding: "utf-8",
    mode: 0o755,
  });
  fs.writeFileSync(
    path.join(genDir, "opencode.docker.json"),
    opencodeConfig,
    "utf-8"
  );

  // Ensure .env exists with at least the global secrets
  const globalConfig = loadGlobalConfig();
  const existingSecrets = loadInstanceSecrets(instanceName);
  const secrets: Record<string, string> = { ...existingSecrets };

  // Ensure git identity is in secrets
  if (globalConfig.git) {
    secrets["GIT_AUTHOR_NAME"] = globalConfig.git.name;
    secrets["GIT_COMMITTER_NAME"] = globalConfig.git.name;
    secrets["GIT_AUTHOR_EMAIL"] = globalConfig.git.email;
    secrets["GIT_COMMITTER_EMAIL"] = globalConfig.git.email;
  }

  // GH_TOKEN in .env is used by gh CLI (which reads env vars directly).
  // Git credential authentication is handled separately via per-project
  // credential files (more secure, supports different PATs per project).
  // The GH_TOKEN here is the "best available" PAT for gh CLI commands.
  if (globalConfig.defaultGithubPat && !secrets["GH_TOKEN"]) {
    secrets["GH_TOKEN"] = globalConfig.defaultGithubPat;
  }
  const projects = listProjectsInInstance(instanceName);
  for (const proj of projects) {
    if (proj.githubPat !== "default" && proj.githubPat) {
      secrets["GH_TOKEN"] = proj.githubPat;
    }
  }

  saveInstanceSecrets(instanceName, secrets);

  // Generate per-project git credential files (PATs routed via includeIf)
  generateGitCredentials(projects, globalConfig.defaultGithubPat, genDir, resolved.ssh);

  return { success: true, generatedDir: genDir };
}
