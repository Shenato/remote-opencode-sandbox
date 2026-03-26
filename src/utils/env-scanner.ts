import fs from "node:fs";
import path from "node:path";
import type { EnvRewriteRule } from "../types.ts";

/** Parsed env var */
interface EnvEntry {
  key: string;
  value: string;
  file: string;
}

/** Proposed env override from scanning */
export interface EnvOverrideProposal {
  key: string;
  originalValue: string;
  overrideValue: string;
  file: string;
  reason: string;
}

/**
 * Scan a project directory for .env* files and find env vars
 * that reference localhost/127.0.0.1 and need rewriting for the container.
 */
export function scanProjectEnvFiles(
  projectPath: string,
  rewriteRules: EnvRewriteRule[]
): EnvOverrideProposal[] {
  const envFiles = findEnvFiles(projectPath);
  const proposals: EnvOverrideProposal[] = [];
  const seen = new Set<string>();

  for (const envFile of envFiles) {
    const entries = parseEnvFile(envFile);
    for (const entry of entries) {
      if (seen.has(entry.key)) continue;

      for (const rule of rewriteRules) {
        const regex = new RegExp(rule.pattern, "g");
        if (regex.test(entry.value)) {
          const overrideValue = entry.value.replace(
            new RegExp(rule.pattern, "g"),
            rule.replace
          );
          proposals.push({
            key: entry.key,
            originalValue: entry.value,
            overrideValue,
            file: path.relative(projectPath, entry.file),
            reason: rule.description,
          });
          seen.add(entry.key);
          break; // Only apply first matching rule per var
        }
      }
    }
  }

  return proposals;
}

/** Find all .env* files in a directory (non-recursive) */
function findEnvFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f === ".env" || f.startsWith(".env."))
      .filter((f) => !f.endsWith(".example") && !f.endsWith(".sample"))
      .map((f) => path.join(dir, f))
      .filter((f) => fs.statSync(f).isFile());
  } catch {
    return [];
  }
}

/** Parse a .env file into key-value pairs */
function parseEnvFile(filePath: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      entries.push({ key, value, file: filePath });
    }
  } catch {
    // Skip unreadable files
  }
  return entries;
}

/**
 * Read all env vars from a project's .env files,
 * returning a flat record of key→value (later files override earlier).
 */
export function readAllProjectEnvVars(
  projectPath: string
): Record<string, string> {
  const envFiles = findEnvFiles(projectPath);
  const vars: Record<string, string> = {};
  for (const envFile of envFiles) {
    for (const entry of parseEnvFile(envFile)) {
      vars[entry.key] = entry.value;
    }
  }
  return vars;
}
