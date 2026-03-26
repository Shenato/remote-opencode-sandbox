# remote-opencode-sandbox

Run [OpenCode](https://opencode.ai) in a secure Docker sandbox, accessible via Discord through [remote-opencode](https://github.com/underdune/remote-opencode). Multi-project, templated, auto-configured.

## What it does

`sandbox` is a CLI tool that generates Docker configurations for running OpenCode inside a container. It handles:

- **Docker file generation** — Dockerfile, docker-compose.yml, entrypoint with process supervisor
- **Multi-project support** — Multiple projects bind-mounted into one container at `/workspace/<project>`
- **Template system** — Pre-configured setups for common stacks (web+Supabase, Node.js, etc.)
- **Env var management** — Auto-detects `localhost` references in `.env` files and rewrites them for container use
- **Service orchestration** — Oneshot + daemon services with dependency resolution, watchdog monitoring, crash-loop backoff
- **Host service coordination** — Start/stop host-side services (Supabase, databases) alongside the container
- **MCP server configuration** — Auto-configures chrome-devtools, supabase-local, and other MCPs for the container

## Architecture

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

One container per instance. Multiple projects per container. Projects are bind-mounted, so edits on the host are reflected immediately inside the container.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (Docker Desktop or Docker Engine)
- [Bun](https://bun.sh) (for running the CLI)
- [Node.js](https://nodejs.org) 18+ (for npm global installs inside the container)

## Installation

### Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/underdune/remote-opencode-sandbox/main/install.sh | bash
```

### Manual install

```bash
git clone https://github.com/underdune/remote-opencode-sandbox.git
cd remote-opencode-sandbox
bun install
bun link
```

## Quick start

```bash
# 1. First-time setup (git identity, GitHub PAT)
sandbox init

# 2. Add a project
sandbox add ~/repos/my-project --template web-supabase

# 3. Generate Docker files and start
sandbox up
```

## CLI commands

| Command | Description |
|---------|-------------|
| `sandbox init` | First-time setup: git identity, GitHub PAT |
| `sandbox add <path>` | Add a project (interactive template selection, env scanning) |
| `sandbox remove <project>` | Remove a project from an instance |
| `sandbox build` | Generate Docker files from config |
| `sandbox up` | Build and start the sandbox |
| `sandbox down` | Stop the sandbox and host services |
| `sandbox restart` | Restart the sandbox |
| `sandbox logs [-f]` | View container logs |
| `sandbox shell` | Open a shell inside the container |
| `sandbox status` | Show status of all instances |
| `sandbox config show [project]` | Show global or project config |
| `sandbox config edit` | Open config directory in $EDITOR |
| `sandbox templates` | List available templates |
| `sandbox instance create/list/remove` | Manage instances |
| `sandbox setup-autostart` | Set up auto-start on boot (Linux) |

All commands accept `--instance <name>` (default: `default`).

## Templates

### web-supabase

Web app with Supabase. Vite dev server runs in the container, Supabase runs on the host.

- **Container services:** `bun install` (oneshot), `vite dev` (daemon, port 8080)
- **Host services:** `supabase start` (oneshot), `supabase functions serve` (daemon)
- **MCPs:** chrome-devtools, supabase-local
- **Env rewrites:** `localhost:54321` -> `host.docker.internal:54321`

### node-basic

Plain Node.js project with no extra host services.

- **Container services:** `bun install` (oneshot)
- **MCPs:** chrome-devtools
- **Env rewrites:** Any `localhost:<port>` -> `host.docker.internal:<port>`

## Configuration

Config lives in `~/.config/remote-opencode-sandbox/` and never pollutes project repos (except the optional `.sandbox.json`).

### Config merge hierarchy (later wins)

1. Template defaults (e.g., `web-supabase`)
2. Global config (`~/.config/remote-opencode-sandbox/config.json`)
3. Instance config (`instances/<name>/instance.json`)
4. Project-level `.sandbox.json` (lives in the project repo, optional)
5. Per-project config (`instances/<name>/projects/<project>.json`)

### Directory structure

```
~/.config/remote-opencode-sandbox/
  config.json                    # Global: git identity, default PAT
  instances/
    default/
      instance.json              # Instance: project list, docker overrides
      projects/
        my-project.json          # Per-project: template, services, env, ports
      generated/
        Dockerfile               # Generated — editable, regenerated by `sandbox build`
        docker-compose.yml
        docker-entrypoint.sh
        opencode.docker.json
        .env                     # Secrets (never committed)
```

### Project .sandbox.json (optional)

Place a `.sandbox.json` in your project root to commit sandbox config alongside your code:

```json
{
  "template": "web-supabase",
  "services": {
    "container": [
      { "name": "test-watcher", "command": "bun run test --watch", "type": "daemon", "restart": "on-failure" }
    ]
  },
  "env": {
    "override": { "API_URL": "http://host.docker.internal:3000" },
    "passthrough": ["VITE_SUPABASE_ANON_KEY"],
    "secrets": ["STRIPE_SECRET_KEY"]
  },
  "ports": ["3000:3000"],
  "mcp": {
    "my-custom-mcp": { "type": "local", "command": ["node", "mcp-server.js"] }
  },
  "permission": "allow"
}
```

## Env var strategy

- **Project `.env` files** are never modified by the tool
- **Overrides:** Injected via Docker Compose `environment:` block (highest precedence). `localhost` references are rewritten to `host.docker.internal` for container use
- **Passthrough:** Env vars from project `.env` files pass through as-is inside the container (via bind-mounted project directory)
- **Secrets:** Stored in `~/.config/.../generated/.env`, loaded via `env_file:` in compose. Never committed.
- **Auto-detection:** Templates define `envRewriteRules` that scan `.env*` files and propose overrides during `sandbox add`

## Multi-project instances

An "instance" is a single Docker container. Multiple projects are bind-mounted at `/workspace/<project-name>`:

```bash
sandbox add ~/repos/frontend --template web-supabase
sandbox add ~/repos/api --template node-basic
sandbox build
sandbox up
```

If projects conflict (port collisions, env var conflicts), create separate instances:

```bash
sandbox instance create staging
sandbox add ~/repos/staging-app --template web-supabase --instance staging
sandbox up --instance staging
```

## Service model

Services are defined per-project and run inside the container or on the host.

- **oneshot:** Run once, must exit 0 before dependents start (e.g., `bun install`)
- **daemon:** Long-running, monitored by watchdog with configurable restart policy (`always`, `on-failure`, `never`) and crash-loop backoff
- **Container services:** Run inside the Docker container (dev servers, watchers)
- **Host services:** Run on the host machine (Supabase, databases)
- **Dependency resolution:** Topological sort, parallel startup for independent services
- **`remote-opencode`** is always added as the last daemon automatically

Service names are namespaced per project (`project:service`) to avoid collisions.

## Generated files

`sandbox build` generates five files, all editable:

| File | Purpose |
|------|---------|
| `Dockerfile` | Container image: Node.js, Bun, Chrome, OpenCode, remote-opencode, gh CLI |
| `docker-compose.yml` | Service definition: volumes, ports, env, security hardening |
| `docker-entrypoint.sh` | Process supervisor: oneshot execution, daemon monitoring, watchdog |
| `opencode.docker.json` | OpenCode config for the container: permission level, MCP servers |
| `.env` | Secrets: GitHub PAT, git identity (never committed) |

## Auto-start on boot (Linux)

```bash
sandbox setup-autostart
```

Creates a systemd user service and (optionally) an XDG autostart entry for Docker Desktop. On login: Docker Desktop starts, then systemd starts the sandbox.

## Contributing

Templates are community-extensible via PRs. To add a new template:

1. Create `src/templates/my-template.ts` implementing the `Template` interface
2. Register it in `src/templates/index.ts`
3. Submit a PR

## License

MIT
