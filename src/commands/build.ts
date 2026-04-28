import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
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
  generateAgentsMd,
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

  // If a local remote-opencode fork is configured, npm pack it into the build context
  const instanceConfigRaw = JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(genDir), "instance.json"),
      "utf-8"
    )
  );
  if (instanceConfigRaw.localRemoteOpencodePath) {
    const localPath = path.resolve(instanceConfigRaw.localRemoteOpencodePath);
    if (!fs.existsSync(path.join(localPath, "package.json"))) {
      return {
        success: false,
        generatedDir: genDir,
        error: `localRemoteOpencodePath "${localPath}" does not contain a package.json`,
      };
    }
    try {
      // Build first (compiles TypeScript to dist/)
      console.log(`  Building local remote-opencode...`);
      execSync("npm run build", { cwd: localPath, stdio: "pipe" });
      const tarballName = execSync("npm pack --pack-destination " + JSON.stringify(genDir), {
        cwd: localPath,
        encoding: "utf-8",
      }).trim().split("\n").pop()!;
      resolved.localRemoteOpencodeTarball = tarballName;
      console.log(`  Packed local remote-opencode: ${tarballName}`);
    } catch (err) {
      return {
        success: false,
        generatedDir: genDir,
        error: `Failed to npm pack local remote-opencode at "${localPath}": ${err}`,
      };
    }
  }

  // Generate all files
  const dockerfile = generateDockerfile(resolved);
  const compose = generateCompose(resolved);
  const entrypoint = generateEntrypoint(resolved);
  const opencodeConfig = generateOpenCodeConfig(resolved);
  const agentsMd = generateAgentsMd(resolved);

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
  fs.writeFileSync(path.join(genDir, "AGENTS.md"), agentsMd, "utf-8");

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
  //
  // The default PAT is used for GH_TOKEN because it typically has broader
  // permissions (e.g. repo creation) needed for `gh` CLI operations that
  // aren't project-scoped. Per-project PATs only route git push/pull via
  // credential helpers (includeIf).
  const projects = listProjectsInInstance(instanceName);
  if (!secrets["GH_TOKEN"]) {
    // Seed with a per-project PAT as baseline (if no default PAT exists)
    for (const proj of projects) {
      if (proj.githubPat !== "default" && proj.githubPat) {
        secrets["GH_TOKEN"] = proj.githubPat;
      }
    }
  }
  // Default PAT always wins — it's the one with broad permissions
  if (globalConfig.defaultGithubPat) {
    secrets["GH_TOKEN"] = globalConfig.defaultGithubPat;
  }

  saveInstanceSecrets(instanceName, secrets);

  // Generate per-project git credential files (PATs routed via includeIf)
  generateGitCredentials(projects, globalConfig.defaultGithubPat, genDir, resolved.ssh);

  return { success: true, generatedDir: genDir };
}
