import type { Template } from "../types.ts";
import { DEFAULT_BASE_IMAGE } from "../constants.ts";

/** Godot version to install — update this when a new stable release ships */
const GODOT_VERSION = "4.6.1";
const GODOT_BINARY = `Godot_v${GODOT_VERSION}-stable_linux.x86_64`;
const GODOT_ZIP = `${GODOT_BINARY}.zip`;
const GODOT_DOWNLOAD_URL = `https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/${GODOT_ZIP}`;
const GODOT_INSTALL_PATH = "/usr/local/bin/godot";

export const godotGamedevTemplate: Template = {
  name: "godot-gamedev",
  description:
    "Godot 4 game development — headless engine in container with Godot MCP tools",
  docker: {
    baseImage: DEFAULT_BASE_IMAGE,
    installChrome: false,
    installBun: true,
    installSupabaseCli: false,
    extraPackages: [],
    installSteps: [
      {
        name: "godot",
        comment: `Godot Engine ${GODOT_VERSION} (headless)`,
        description:
          `Godot ${GODOT_VERSION} game engine installed at \`${GODOT_INSTALL_PATH}\`. ` +
          `Runs headless via Xvfb (DISPLAY=:99). Use the \`godot\` MCP tool server for ` +
          `scene creation, node management, and project operations. For direct CLI usage: ` +
          `\`godot --headless --script <script.gd>\` for scripted operations, ` +
          `\`godot --headless --export-release <preset> <output>\` for exports.`,
        aptPackages: [
          // Virtual framebuffer for headless rendering
          "xvfb",
          // OpenGL / rendering dependencies
          "libgl1",
          "libglu1-mesa",
          "libegl1",
          // Audio (Godot expects these even in headless mode)
          "libasound2",
          "libpulse0",
          // X11 libraries
          "libx11-6",
          "libxcursor1",
          "libxi6",
          "libxinerama1",
          "libxrandr2",
          "libxrender1",
          // Font rendering
          "libfontconfig1",
          "libfreetype6",
        ],
        instructions: [
          `RUN wget -q -O /tmp/${GODOT_ZIP} ${GODOT_DOWNLOAD_URL} \\`,
          `    && unzip -q /tmp/${GODOT_ZIP} -d /tmp \\`,
          `    && mv /tmp/${GODOT_BINARY} ${GODOT_INSTALL_PATH} \\`,
          `    && chmod +x ${GODOT_INSTALL_PATH} \\`,
          `    && rm -f /tmp/${GODOT_ZIP}`,
        ],
      },
    ],
  },
  services: {
    container: [
      {
        name: "xvfb",
        command: "Xvfb :99 -screen 0 1280x720x24 -nolisten tcp",
        type: "daemon",
        restart: "always",
        env: { DISPLAY: ":99" },
      },
    ],
    host: [],
  },
  envOverrides: {
    DISPLAY: ":99",
    GODOT_PATH: GODOT_INSTALL_PATH,
  },
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
    godot: {
      type: "local",
      command: ["npx", "-y", "@coding-solo/godot-mcp"],
      environment: {
        GODOT_PATH: GODOT_INSTALL_PATH,
        DEBUG: "true",
      },
    },
  },
  ports: [],
  permission: "allow",
  defaultSecrets: ["GH_TOKEN"],
};
