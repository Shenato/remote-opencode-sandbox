# remote-opencode-sandbox

Your own self-hosted AI coding agent — like [GitHub Copilot coding agent](https://github.com/features/copilot), [Claude Code](https://claude.ai), or [Devin](https://devin.ai), but running on your own machine, fully under your control.

This tool sets up a secure Docker sandbox for [OpenCode](https://opencode.ai) (an open-source AI coding agent) and connects it to Discord via [remote-opencode](https://github.com/bevibing/remote-opencode), so you can manage your coding sessions from anywhere — your phone, another computer, or any device with Discord.
This tool sets up a secure Docker sandbox for [OpenCode](https://opencode.ai) (an open-source AI coding agent) and connects it to Discord via , so you can manage your coding sessions from anywhere — your phone, another computer, or any device with Discord.

## What problem does this solve?

Cloud-based AI coding agents (Copilot agents, Devin, etc.) run on someone else's infrastructure. They have limited context about your local setup, can't access your local databases or services, and you have no control over the environment. Self-hosted alternatives like running OpenCode directly on your machine give you full control, but come with risks — the agent has unrestricted access to your filesystem, network, and credentials.

**remote-opencode-sandbox** gives you the best of both worlds:

- **Self-hosted cloud agent experience** — Set it up once, then manage everything from Discord. Send a message, the AI codes. Review diffs, approve commits, run tests — all from your phone. It's like having your own Copilot coding agent, but it runs against your actual local dev environment (local Supabase, local databases, your real `.env` files).
- **Security** — OpenCode runs inside a locked-down Docker container as a non-root user with dropped capabilities, `no-new-privileges`, and tmpfs mounts. Your host filesystem is untouched except for explicitly bind-mounted project directories. The agent can only see and modify the projects you explicitly give it access to.
- **Full local context** — Unlike cloud agents, the sandbox container can reach your host services (Supabase, Postgres, Redis) via `host.docker.internal`. Your dev servers run inside the container with your real config. The AI works with your actual project, not a stripped-down copy.
- **Multi-project** — Mount multiple projects into a single container. Each gets its own `node_modules` volume, git credentials, and service configuration. Work on a frontend and backend simultaneously.
- **Reproducible** — Everything is generated from config. Tear it down and rebuild in seconds. Share `.sandbox.json` with your team so everyone gets the same setup.
- **Always running** — Set up systemd auto-start and the sandbox comes up on boot. Your AI coding agent is always ready, waiting for instructions on Discord.

## How it works

```
Host Machine                          Docker Container
+---------------------------+         +---------------------------+
| sandbox CLI               |         | /workspace/project-a/     |
| ~/.config/remote-opencode |         | /workspace/project-b/     |
|   -sandbox/               |         |                           |
|                           |         | Services:                 |
| Host services:            |         |   bun install (oneshot)   |
|   supabase start          |   <-->  |   vite dev (daemon)       |
|   supabase functions      |         |   remote-opencode (daemon)|
+---------------------------+         +---------------------------+
```

1. You run `sandbox add` to register projects and pick a template
2. `sandbox build` generates a Dockerfile, docker-compose.yml, entrypoint script, OpenCode config, and secrets
3. `sandbox up` starts host-side services (e.g., Supabase), then builds and starts the container
4. Inside the container, a process supervisor runs oneshot tasks (install deps), starts daemon services (dev servers), and launches `remote-opencode` last
5. A watchdog monitors all daemons and restarts them with crash-loop backoff

Projects are bind-mounted, so edits on the host (or by OpenCode inside the container) are reflected immediately in both directions.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (Docker Desktop or Docker Engine)
- [Bun](https://bun.sh) (for running the CLI)
- [Node.js](https://nodejs.org) 18+ (for npm global installs inside the container)

## Installation

### Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/Shenato/remote-opencode-sandbox/main/install.sh | bash
```

This installs Bun, OpenCode, remote-opencode, and the sandbox CLI automatically. Docker must be installed separately.

### Manual install

```bash
git clone https://github.com/Shenato/remote-opencode-sandbox.git
cd remote-opencode-sandbox
bun install
bun link
```

After linking, the `sandbox` command is available globally.

## Quick start

```bash
# 1. First-time setup — sets your git identity, GitHub PAT, and optional SSH key
sandbox init

# 2. Add a project — picks a template, scans .env files, configures services
sandbox add ~/projects/my-app --template web-supabase

# 3. Build Docker files and start everything
sandbox up
```

That's it. OpenCode is now running inside Docker and reachable via Discord.

## CLI reference

| Command | Description |
|---------|-------------|
| `sandbox init` | First-time setup: git identity, GitHub PAT, SSH key |
| `sandbox add <path>` | Add a project (interactive: template, env scanning, services) |
| `sandbox remove <project>` | Remove a project from an instance |
| `sandbox build` | Generate Docker files from config |
| `sandbox up` | Build and start the sandbox (container + host services) |
| `sandbox down` | Stop the sandbox and all host services |
| `sandbox restart` | Stop, rebuild, and restart |
| `sandbox logs [-f]` | View container logs (optionally follow) |
| `sandbox shell` | Open a bash shell inside the running container |
| `sandbox status` | Show status of all instances and their projects |
| `sandbox config show [project]` | Show global or project config as JSON |
| `sandbox config edit` | Open the config directory in `$EDITOR` |
| `sandbox templates` | List available project templates |
| `sandbox instance create <name>` | Create a new instance |
| `sandbox instance list` | List all instances |
| `sandbox instance remove <name>` | Delete an instance and its config |
| `sandbox setup-autostart` | Set up systemd auto-start on boot (Linux) |

All commands accept `--instance <name>` to target a specific instance (default: `default`).

## Templates

Templates are pre-configured setups for common project types. They define default services, env rewrites, MCP servers, and Docker image settings.

### `web-supabase`

Full-stack web app with Supabase local development. Vite dev server runs inside the container, Supabase runs on the host.

| | Details |
|---|---|
| **Base image** | `node:24-bookworm` |
| **Container services** | `bun install` (oneshot), `vite dev --host 0.0.0.0` (daemon, port 8080) |
| **Host services** | `supabase start` (oneshot), `supabase functions serve` (daemon) |
| **MCP servers** | `chrome-devtools` (headless Chrome), `supabase-local` (Supabase MCP) |
| **Env rewrites** | `localhost:54321` → `host.docker.internal:54321` (Supabase API) |
| | `localhost:54322` → `host.docker.internal:54322` (Supabase Postgres) |
| **Ports** | `8080:8080` |
| **Installs** | Chrome, Bun, Supabase CLI, GitHub CLI, OpenCode |

### `node-basic`

Plain Node.js project with no host-side services.

| | Details |
|---|---|
| **Base image** | `node:24-bookworm` |
| **Container services** | `bun install` (oneshot) |
| **Host services** | None |
| **MCP servers** | `chrome-devtools` (headless Chrome) |
| **Env rewrites** | Any `localhost:<port>` → `host.docker.internal:<port>` |
| **Ports** | None (add your own) |
| **Installs** | Chrome, Bun, GitHub CLI, OpenCode |

### Adding your own templates

Create a new file in `src/templates/` implementing the `Template` interface, register it in `src/templates/index.ts`, and submit a PR.

## Configuration

All config lives in `~/.config/remote-opencode-sandbox/`. Nothing is written to your project repos (except the optional `.sandbox.json`).

### Directory structure

```
~/.config/remote-opencode-sandbox/
├── config.json                        # Global: git identity, default PAT
└── instances/
    └── default/
        ├── instance.json              # Instance: project list, docker overrides
        ├── projects/
        │   └── my-project.json        # Per-project: template, services, env, ports
        └── generated/
            ├── Dockerfile             # Generated (editable, regenerated by build)
            ├── docker-compose.yml
            ├── docker-entrypoint.sh
            ├── opencode.docker.json
            ├── .env                   # Secrets (never committed)
            └── git-credentials/       # Per-project PAT files (never committed)
```

### Config merge hierarchy

Configuration is merged in layers, with later layers overriding earlier ones:

1. **Template defaults** — base services, env rewrites, MCP servers
2. **Global config** — git identity, default GitHub PAT
3. **Instance config** — docker overrides, extra packages, instance-level MCPs
4. **Project `.sandbox.json`** — committed to the repo, shared with team
5. **Per-project config** — stored in `~/.config/...`, machine-specific overrides

### Global config (`config.json`)

Created by `sandbox init`. Contains your git identity, default GitHub PAT, and optional SSH key configuration.

```json
{
  "git": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "defaultGithubPat": "ghp_...",
  "ssh": {
    "keyPath": "~/.ssh/id_ed25519",
    "githubUsername": "your-github-username"
  },
  "defaultInstance": "default"
}
```

### Instance config (`instance.json`)

Each instance can override Docker settings and add instance-level configuration:

```json
{
  "name": "default",
  "projects": ["my-frontend", "my-api"],
  "extraPackages": ["python3", "postgresql-client"],
  "docker": {
    "baseImage": "node:24-bookworm",
    "installChrome": true,
    "installBun": true,
    "installSupabaseCli": true,
    "extraPackages": []
  },
  "mcp": {
    "custom-mcp": {
      "type": "remote",
      "url": "http://host.docker.internal:9000/mcp"
    }
  }
}
```

### Project config (`projects/<name>.json`)

Created by `sandbox add`. Contains template selection, services, env overrides, and secrets:

```json
{
  "name": "my-project",
  "hostPath": "/home/user/projects/my-project",
  "instance": "default",
  "template": "web-supabase",
  "githubPat": "default",
  "services": {
    "container": [
      {
        "name": "install",
        "command": "bun install",
        "type": "oneshot",
        "restart": "never"
      },
      {
        "name": "dev",
        "command": "bun run vite --mode localDev --host 0.0.0.0",
        "port": 8080,
        "type": "daemon",
        "restart": "always",
        "dependsOn": ["install"]
      }
    ],
    "host": [
      {
        "name": "supabase",
        "start": "supabase start",
        "stop": "supabase stop",
        "healthCheck": "supabase status",
        "type": "oneshot"
      }
    ]
  },
  "envOverrides": {
    "VITE_SUPABASE_URL": "http://host.docker.internal:54321",
    "SUPABASE_URL": "http://host.docker.internal:54321"
  },
  "envPassthrough": ["VITE_SUPABASE_ANON_KEY"],
  "envSecrets": ["GH_TOKEN"],
  "ports": ["8080:8080"],
  "permission": "allow"
}
```

## Project `.sandbox.json` (optional)

Place a `.sandbox.json` in your project root to commit sandbox config alongside your code. This is useful for sharing configuration with your team:

```json
{
  "template": "web-supabase",
  "services": {
    "container": [
      {
        "name": "test-watcher",
        "command": "bun run test --watch",
        "type": "daemon",
        "restart": "on-failure"
      }
    ]
  },
  "env": {
    "override": {
      "API_URL": "http://host.docker.internal:3000"
    },
    "passthrough": ["VITE_SUPABASE_ANON_KEY"],
    "secrets": ["STRIPE_SECRET_KEY"]
  },
  "ports": ["3000:3000"],
  "mcp": {
    "my-custom-mcp": {
      "type": "local",
      "command": ["node", "mcp-server.js"]
    }
  },
  "permission": "allow"
}
```

When `sandbox add` detects a `.sandbox.json`, it merges it with the selected template's defaults.

## Example configurations

### Example 1: Single Next.js project

A Next.js app with no backend services. Just run the dev server inside the container.

```bash
sandbox init
sandbox add ~/projects/my-nextjs-app --template node-basic
sandbox up
```

After `sandbox add`, edit the generated project config to add the dev server:

```bash
sandbox config edit
```

Or create a `.sandbox.json` in the project root before running `sandbox add`:

```json
{
  "template": "node-basic",
  "services": {
    "container": [
      {
        "name": "install",
        "command": "bun install",
        "type": "oneshot",
        "restart": "never"
      },
      {
        "name": "dev",
        "command": "bun run next dev --hostname 0.0.0.0 --port 3000",
        "port": 3000,
        "type": "daemon",
        "restart": "always",
        "dependsOn": ["install"]
      }
    ]
  },
  "ports": ["3000:3000"]
}
```

Then access the dev server at `http://localhost:3000` on your host machine.

### Example 2: Full-stack web app with Supabase

A Vite + React frontend with Supabase for auth, database, and edge functions.

```bash
sandbox init
sandbox add ~/projects/my-saas-app --template web-supabase
sandbox up
```

The `web-supabase` template handles everything automatically:
- Starts Supabase on the host (`supabase start` + `supabase functions serve`)
- Starts the Vite dev server inside the container on port 8080
- Rewrites `localhost:54321` to `host.docker.internal:54321` so the container can reach Supabase
- Configures the `supabase-local` MCP server so OpenCode can interact with your database
- Configures `chrome-devtools` MCP so OpenCode can inspect your running app

Your `.env` file might look like this on the host:

```env
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
```

The sandbox automatically detects the `localhost:54321` reference and rewrites it to `host.docker.internal:54321` for the container. Your original `.env` is never modified.

### Example 3: Multi-project monorepo setup

A frontend and API running in the same container:

```bash
sandbox init
sandbox add ~/projects/frontend --template web-supabase
sandbox add ~/projects/api --template node-basic
sandbox up
```

Both projects are mounted at `/workspace/frontend` and `/workspace/api` inside the container. Each gets its own `node_modules` volume.

Add a `.sandbox.json` to the API project:

```json
{
  "template": "node-basic",
  "services": {
    "container": [
      {
        "name": "install",
        "command": "bun install",
        "type": "oneshot",
        "restart": "never"
      },
      {
        "name": "api-server",
        "command": "bun run dev",
        "port": 4000,
        "type": "daemon",
        "restart": "always",
        "dependsOn": ["install"]
      }
    ]
  },
  "ports": ["4000:4000"],
  "env": {
    "override": {
      "DATABASE_URL": "postgresql://postgres:postgres@host.docker.internal:54322/postgres"
    }
  }
}
```

### Example 4: Separate instances for isolated environments

When projects have conflicting ports or you want full isolation:

```bash
# Production-like staging environment
sandbox instance create staging
sandbox add ~/projects/staging-app --template web-supabase --instance staging

# Development environment
sandbox add ~/projects/dev-app --template web-supabase

# Start them independently
sandbox up                    # starts default instance
sandbox up --instance staging # starts staging instance
```

Each instance gets its own Docker container, ports, and secrets.

### Example 5: Custom services and MCP servers

A project with a custom background worker and a project-specific MCP server:

```json
{
  "template": "node-basic",
  "services": {
    "container": [
      {
        "name": "install",
        "command": "npm install",
        "type": "oneshot",
        "restart": "never"
      },
      {
        "name": "dev",
        "command": "npm run dev",
        "port": 3000,
        "type": "daemon",
        "restart": "always",
        "dependsOn": ["install"]
      },
      {
        "name": "worker",
        "command": "npm run worker",
        "type": "daemon",
        "restart": "on-failure",
        "dependsOn": ["install"]
      }
    ],
    "host": [
      {
        "name": "redis",
        "start": "docker compose -f docker-compose.redis.yml up -d",
        "stop": "docker compose -f docker-compose.redis.yml down",
        "healthCheck": "docker compose -f docker-compose.redis.yml ps --quiet redis",
        "type": "oneshot"
      }
    ]
  },
  "ports": ["3000:3000"],
  "env": {
    "override": {
      "REDIS_URL": "redis://host.docker.internal:6379"
    },
    "secrets": ["OPENAI_API_KEY", "STRIPE_SECRET_KEY"]
  },
  "mcp": {
    "project-docs": {
      "type": "local",
      "command": ["node", "tools/mcp-docs-server.js"]
    }
  }
}
```

### Example 6: Python project with custom base image

Override the Docker config for a Python project:

```json
{
  "template": "node-basic",
  "services": {
    "container": [
      {
        "name": "install",
        "command": "pip install -r requirements.txt",
        "type": "oneshot",
        "restart": "never"
      },
      {
        "name": "dev",
        "command": "python manage.py runserver 0.0.0.0:8000",
        "port": 8000,
        "type": "daemon",
        "restart": "always",
        "dependsOn": ["install"]
      }
    ]
  },
  "ports": ["8000:8000"],
  "docker": {
    "extraPackages": ["python3", "python3-pip", "python3-venv"]
  }
}
```

## Env var strategy

The sandbox uses a layered approach to environment variables, ensuring your project's `.env` files are never modified:

| Layer | Source | Mechanism | Precedence |
|-------|--------|-----------|------------|
| **Project `.env`** | Your repo's `.env` files | Bind-mounted into container | Lowest |
| **Overrides** | `envOverrides` in config | Docker Compose `environment:` block | Higher (overrides `.env`) |
| **Secrets** | `~/.config/.../generated/.env` | Docker Compose `env_file:` | Highest |

### Automatic env rewriting

When you `sandbox add` a project, the CLI scans all `.env*` files and looks for `localhost` or `127.0.0.1` references. These can't work inside a container, so it proposes rewriting them to `host.docker.internal`:

```
  SUPABASE_URL: http://localhost:54321 → http://host.docker.internal:54321
    From: .env (Supabase API)

  Accept these overrides? (Y/n)
```

The overrides are injected via Docker Compose's `environment:` block, which takes precedence over the bind-mounted `.env` file. Your original files are never touched.

### Secrets

Secrets (GitHub PAT, API keys) are stored in `~/.config/remote-opencode-sandbox/instances/<name>/generated/.env` and loaded via `env_file:` in the compose config. This file is never committed (it's in your home directory, not in the project).

## SSH key authentication

Instead of (or in addition to) PAT-based HTTPS authentication, you can mount an SSH private key into the container for git operations. This is useful when your GitHub account uses SSH keys for authentication.

### Setup

During `sandbox init`, the CLI auto-detects SSH private keys in `~/.ssh/` and lets you select one. You can also configure it manually in `~/.config/remote-opencode-sandbox/config.json`:

```json
{
  "ssh": {
    "keyPath": "~/.ssh/id_ed25519",
    "githubUsername": "your-github-username"
  }
}
```

### How it works

When SSH is configured, `sandbox build` generates the following:

1. **Volume mounts** — Your SSH private key (and public key) are mounted read-only into the container at `/home/coder/.ssh/id_key`
2. **SSH config** — The entrypoint creates `/home/coder/.ssh/config` pointing to the mounted key with `IdentitiesOnly yes`
3. **known_hosts** — GitHub's host keys are fetched via `ssh-keyscan` at container startup
4. **Git URL rewriting** — All `https://github.com/` URLs are rewritten to `git@github.com:` via `git config url."git@github.com:".insteadOf`, so git automatically uses SSH for all GitHub operations

### Security notes

- The SSH private key is mounted **read-only** — the container cannot modify it
- The key file is only accessible to the `coder` user (UID 1000)
- `StrictHostKeyChecking` is set to `accept-new` — new host keys are accepted but changed keys are rejected
- The `.ssh` directory is created with `700` permissions in the Dockerfile

### Using SSH alongside PATs

SSH and PATs coexist cleanly with per-project scoping:

- **Projects with a PAT** — Use HTTPS authentication via `git-credential-store`. The PAT always takes precedence.
- **Projects without a PAT** — If SSH is configured, git URLs are rewritten from `https://github.com/` to `git@github.com:` for that project directory only.
- **Fallback** — For repos outside any project directory: uses the default PAT if set, otherwise SSH.
- **gh CLI** — Always uses the PAT via `GH_TOKEN` env var (SSH doesn't affect the GitHub CLI).

This means you can mix authentication methods: some projects use PATs (with fine-grained scoping), others use your SSH key.

## Service model

Services are defined per-project and orchestrated by a bash process supervisor inside the container.

### Service types

| Type | Behavior |
|------|----------|
| **oneshot** | Runs once, must exit 0 before dependents start. Used for `bun install`, `pip install`, etc. |
| **daemon** | Long-running, monitored by a watchdog every 15 seconds. Restarted according to its restart policy. |

### Restart policies (daemons only)

| Policy | Behavior |
|--------|----------|
| `always` | Restart on any exit |
| `on-failure` | Restart only on non-zero exit code |
| `never` | Let it stay dead |

### Crash-loop backoff

If a daemon crashes more than 5 times within 120 seconds, the watchdog backs off for 60 seconds before restarting it. This prevents runaway restart loops.

### Dependency resolution

Services declare dependencies via `dependsOn`. The supervisor performs a topological sort and starts services in the correct order. Independent services start in parallel.

```json
{
  "name": "dev",
  "command": "bun run dev",
  "type": "daemon",
  "dependsOn": ["install"]
}
```

### Service namespacing

In multi-project setups, service names are automatically namespaced as `project:service` to avoid collisions. For example, if both `frontend` and `api` have an `install` service, they become `frontend:install` and `api:install`.

### The `remote-opencode` daemon

`remote-opencode` is always added as the last daemon automatically. It's the Discord bridge that lets you interact with OpenCode from anywhere. You don't need to configure it — it's injected by the entrypoint script.

## Generated files

`sandbox build` generates these files in `~/.config/remote-opencode-sandbox/instances/<name>/generated/`:

| File | Purpose |
|------|---------|
| `Dockerfile` | Container image: Node.js 24, Bun, Chrome, OpenCode, remote-opencode, GitHub CLI |
| `docker-compose.yml` | Service definition: volumes, ports, env vars, security hardening |
| `docker-entrypoint.sh` | Process supervisor: dependency resolution, daemon monitoring, watchdog |
| `opencode.docker.json` | OpenCode config for the container: permission level, MCP servers |
| `.env` | Secrets: GitHub PAT, git identity (never committed) |
| `git-credentials/` | Per-project PAT files + gitconfig routing via `includeIf` |

All generated files are human-readable and editable. They are regenerated by `sandbox build`, so manual edits are overwritten unless you skip the build (`sandbox up --no-build`).

## Security

The container is hardened with several layers:

- **Non-root user** — Everything runs as `coder` (UID 1000)
- **`no-new-privileges`** — Prevents privilege escalation
- **Dropped capabilities** — All capabilities dropped, only `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID`, `SETUID` (and `SYS_ADMIN` for Chrome) are added back
- **tmpfs mounts** — `/tmp` (512MB) and `/run` (64MB) are tmpfs
- **Read-only credentials** — Git credentials, SSH keys, and OpenCode config are mounted read-only
- **No host network** — Container uses `host.docker.internal` to reach host services, not `--network host`
- **Per-project PATs** — Git credentials are routed via `includeIf` directives, so each project can use a different GitHub PAT with minimal scope

## Multi-project instances

An "instance" is a single Docker container running one or more projects.

```bash
# Both projects share a container
sandbox add ~/projects/frontend --template web-supabase
sandbox add ~/projects/backend --template node-basic
sandbox up
```

Inside the container:
```
/workspace/
├── frontend/     # bind-mounted from ~/projects/frontend
│   └── node_modules/   # named Docker volume (not from host)
└── backend/      # bind-mounted from ~/projects/backend
    └── node_modules/   # named Docker volume (not from host)
```

If projects conflict (port collisions, incompatible env vars), create separate instances:

```bash
sandbox instance create project-b
sandbox add ~/projects/other-app --template node-basic --instance project-b
sandbox up --instance project-b
```

## Auto-start on boot (Linux)

```bash
sandbox setup-autostart
```

This creates:
1. A **systemd user service** (`~/.config/systemd/user/sandbox.service`) that runs `sandbox up` on login
2. An **XDG autostart entry** for Docker Desktop (if installed) so Docker starts before the sandbox

On next login: Docker Desktop starts → systemd starts the sandbox → all projects are running.

## Troubleshooting

### Container can't reach host services

Make sure `host.docker.internal` resolves inside the container. The generated `docker-compose.yml` includes:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

If you're using Docker Engine (not Docker Desktop) on Linux, this requires Docker 20.10+.

### `node_modules` permission errors

Each project's `node_modules` uses a named Docker volume. If you see permission errors, the volume may have been created with the wrong ownership. Fix it:

```bash
# Remove the volume and let it be recreated
docker volume rm <project-name>-node-modules
sandbox up
```

### Port already in use

Check which project is using the port:

```bash
sandbox status
```

Either change the port in the project's config or move the conflicting project to a separate instance:

```bash
sandbox instance create other
sandbox remove my-project
sandbox add ~/projects/my-project --template node-basic --instance other
```

### Rebuilding from scratch

```bash
sandbox down
sandbox build
sandbox up
```

To fully rebuild the Docker image (no cache):

```bash
sandbox down
# Go to the generated directory and rebuild
cd ~/.config/remote-opencode-sandbox/instances/default/generated
docker compose build --no-cache
sandbox up --no-build
```

### Viewing logs

```bash
# Last 100 lines
sandbox logs

# Follow live
sandbox logs -f

# Open a shell to debug
sandbox shell
```

## Contributing

### Adding a new template

1. Create `src/templates/my-template.ts` implementing the `Template` interface:

```typescript
import type { Template } from "../types.ts";
import { DEFAULT_BASE_IMAGE } from "../constants.ts";

export const myTemplate: Template = {
  name: "my-template",
  description: "Description of what this template is for",
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
        command: "npm install",
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
  ],
  mcp: {
    "chrome-devtools": {
      type: "local",
      command: [
        "npx", "-y", "chrome-devtools-mcp@latest",
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
```

2. Register it in `src/templates/index.ts`:

```typescript
import { myTemplate } from "./my-template.ts";

const builtinTemplates: Record<string, Template> = {
  "web-supabase": webSupabaseTemplate,
  "node-basic": nodeBasicTemplate,
  "my-template": myTemplate,
};
```

3. Submit a PR.

### Development

```bash
git clone https://github.com/Shenato/remote-opencode-sandbox.git
cd remote-opencode-sandbox
bun install

# Run the CLI in dev mode
bun run dev

# Type-check
bun run typecheck
```

## License

MIT
