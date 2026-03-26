import path from "node:path";
import os from "node:os";

/** Base config directory */
export const CONFIG_DIR = path.join(
  os.homedir(),
  ".config",
  "remote-opencode-sandbox"
);

/** Subdirectories */
export const INSTANCES_DIR = path.join(CONFIG_DIR, "instances");
export const TEMPLATES_DIR = path.join(CONFIG_DIR, "templates");
export const GLOBAL_CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

/** Project-level config filename */
export const PROJECT_SANDBOX_FILE = ".sandbox.json";

/** Default instance name */
export const DEFAULT_INSTANCE = "default";

/** Container workspace root */
export const CONTAINER_WORKSPACE = "/workspace";

/** Default Docker base image */
export const DEFAULT_BASE_IMAGE = "node:24-bookworm";

/** Watchdog settings */
export const WATCHDOG_INTERVAL = 15;
export const RESTART_DELAY = 5;
export const MAX_RAPID_RESTARTS = 5;
export const RAPID_WINDOW = 120;
export const BACKOFF_DELAY = 60;
