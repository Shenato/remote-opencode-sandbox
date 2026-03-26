import type { Template } from "../types.ts";
import { DEFAULT_BASE_IMAGE } from "../constants.ts";

export const nodeBasicTemplate: Template = {
  name: "node-basic",
  description: "Basic Node.js project — no extra host services",
  docker: {
    baseImage: DEFAULT_BASE_IMAGE,
    installChrome: true,
    installBun: true,
    installSupabaseCli: false,
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
    ],
    host: [],
  },
  envOverrides: {},
  envRewriteRules: [
    {
      pattern: "localhost:(\\d+)",
      replace: "host.docker.internal:$1",
      description: "Any localhost service",
    },
    {
      pattern: "127\\.0\\.0\\.1:(\\d+)",
      replace: "host.docker.internal:$1",
      description: "Any 127.0.0.1 service",
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
  },
  ports: [],
  permission: "allow",
  defaultSecrets: ["GH_TOKEN"],
};
