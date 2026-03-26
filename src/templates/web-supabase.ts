import type { Template } from "../types.ts";
import { DEFAULT_BASE_IMAGE } from "../constants.ts";

export const webSupabaseTemplate: Template = {
  name: "web-supabase",
  description:
    "Web app with Supabase — Vite dev server in container, Supabase local on host via Docker",
  docker: {
    baseImage: DEFAULT_BASE_IMAGE,
    installChrome: true,
    installBun: true,
    installSupabaseCli: true,
    extraPackages: [],
  },
  services: {
    container: [
      {
        name: "install",
        command: "bun install",
        type: "oneshot",
        restart: "never",
      },
      {
        name: "dev",
        command: "bun run vite --mode localDev --host 0.0.0.0",
        port: 8080,
        type: "daemon",
        restart: "always",
        dependsOn: ["install"],
      },
    ],
    host: [
      {
        name: "supabase",
        start: "supabase start",
        stop: "supabase stop",
        healthCheck: "supabase status",
        type: "oneshot",
      },
      {
        name: "supabase-functions",
        start: "supabase functions serve",
        stop: "pkill -f 'supabase functions serve'",
        type: "daemon",
        dependsOn: ["supabase"],
      },
    ],
  },
  envOverrides: {
    VITE_SUPABASE_URL: "http://host.docker.internal:54321",
    SUPABASE_URL: "http://host.docker.internal:54321",
  },
  envRewriteRules: [
    {
      pattern: "localhost:54321",
      replace: "host.docker.internal:54321",
      description: "Supabase API",
    },
    {
      pattern: "127\\.0\\.0\\.1:54321",
      replace: "host.docker.internal:54321",
      description: "Supabase API (127.0.0.1)",
    },
    {
      pattern: "localhost:54322",
      replace: "host.docker.internal:54322",
      description: "Supabase Postgres",
    },
    {
      pattern: "127\\.0\\.0\\.1:54322",
      replace: "host.docker.internal:54322",
      description: "Supabase Postgres (127.0.0.1)",
    },
  ],
  mcp: {
    "chrome-devtools": {
      type: "local",
      command: [
        "npx",
        "-y",
        "chrome-devtools-mcp@latest",
        "--chrome-arg=--no-sandbox",
        "--chrome-arg=--disable-gpu",
        "--chrome-arg=--disable-dev-shm-usage",
        "--headless",
      ],
    },
    "supabase-local": {
      type: "remote",
      url: "http://host.docker.internal:54321/mcp",
      enabled: true,
    },
  },
  ports: ["8080:8080"],
  permission: "allow",
  defaultSecrets: ["GH_TOKEN"],
};
