# Remote OpenCode Sandbox — Developer Guide

This is a CLI tool (`sandbox`) that generates and manages Docker containers running [OpenCode](https://opencode.ai) (an AI coding agent) accessible via Discord. It supports multi-project instances, templated configurations, auto-generated Docker infrastructure, and a self-awareness system so the AI agent inside the container understands its environment.

## Architecture

```
bin/sandbox.ts  →  src/cli.ts (Commander)  →  src/commands/*.ts
                                                     │
                                                     ▼
                                              src/config/manager.ts
                                              (CRUD + resolveInstance)
                                                     │
                                                     ▼
                                              src/generators/*.ts
                                              (Dockerfile, compose, entrypoint,
                                               opencode config, AGENTS.md,
                                               git credentials)
                                                     │
                                              reads src/templates/*.ts
                                              reads src/utils/env-scanner.ts
```

### Data Flow

1. `sandbox init` → writes `~/.config/remote-opencode-sandbox/config.json` (global: PAT, git identity, SSH)
2. `sandbox add <path>` → reads templates, scans `.env` files, prompts user → writes project + instance configs
3. `sandbox build` → calls `resolveInstance()` (merges 5 config layers) → passes `ResolvedInstance` to all 6 generators → writes to `instances/<name>/generated/`
4. `sandbox up` → optionally builds, starts host services, runs `docker compose build && up -d`
5. Inside container: `docker-entrypoint.sh` runs oneshots, starts daemons, starts `remote-opencode` last, runs watchdog loop

### Config Layering (lowest → highest priority)

1. Template defaults (`src/templates/*.ts`)
2. Global config (`~/.config/remote-opencode-sandbox/config.json`)
3. Instance config (`instances/<name>/instance.json`)
4. `.sandbox.json` (committed to each project repo)
5. Per-project config (`instances/<name>/projects/<project>.json`)

## Key Files

| File | Purpose |
|------|---------|
| `bin/sandbox.ts` | 3-line shebang entry point, calls `runCli()` |
| `src/cli.ts` | Commander command registration (all commands + options) |
| `src/types.ts` | All TypeScript interfaces: `GlobalConfig`, `InstanceConfig`, `ProjectConfig`, `DockerConfig`, `DockerInstallStep`, `ContainerService`, `HostService`, `McpServer`, `Template`, `ResolvedInstance`, etc. |
| `src/constants.ts` | Filesystem paths, defaults (`DEFAULT_BASE_IMAGE`, `CONTAINER_WORKSPACE`), watchdog params |
| `src/config/manager.ts` | Config CRUD + `resolveInstance()` — the core merge logic for 5 config layers |
| `src/generators/dockerfile.ts` | Generates Dockerfile from `ResolvedInstance` |
| `src/generators/compose.ts` | Generates `docker-compose.yml` (raw string, not yaml lib) |
| `src/generators/entrypoint.ts` | Generates `docker-entrypoint.sh` — bash process supervisor with dependency ordering, crash-loop backoff, watchdog |
| `src/generators/opencode-config.ts` | Generates `opencode.docker.json` for the AI agent |
| `src/generators/agents-md.ts` | Generates `AGENTS.md` for inside the container (AI self-awareness) |
| `src/generators/git-credentials.ts` | Per-project PAT credential files + gitconfig with `includeIf` routing |
| `src/templates/*.ts` | Template definitions (pure data, no inheritance) |
| `src/utils/env-scanner.ts` | Scans `.env` files for localhost refs needing container overrides |
| `src/commands/build.ts` | Build orchestrator — calls `resolveInstance()` then all generators |
| `src/commands/operations.ts` | Runtime: up/down/restart/restart-bot/logs/shell/status |
| `src/commands/add.ts` | Interactive project addition with template selection, env scanning, service prompts |

## Runtime & Tooling

- **Runtime**: Bun (runs `.ts` directly, no compile step needed for dev)
- **CLI framework**: Commander
- **Entry point**: `npx tsx bin/sandbox.ts <command>` or `bun run bin/sandbox.ts <command>`
- **Type checking**: `npx tsc --noEmit` (strict mode, `noUncheckedIndexedAccess`)
- **No test framework** — `test/test-godot-template.ts` is a standalone script (`npx tsx test/test-godot-template.ts`)
- **Dependencies**: `commander`, `chalk`, `@inquirer/prompts`, `yaml`

## Design Patterns & Conventions

### Service Namespacing
Container services are namespaced as `project:<service>` (from project configs) or `instance:<service>` (from instance config). This prevents name collisions in multi-project setups.

### Install Steps Merge by Name
`DockerInstallStep` objects merge across config layers by their `name` field — a step in a higher-priority layer replaces one with the same name from a lower layer.

### Git Authentication
- **HTTPS repos** use PAT-based auth via `git credential-store`, format: `https://x-access-token:<PAT>@github.com`
- **SSH repos** use mounted SSH keys
- Per-project PATs route via `gitconfig` `[includeIf "gitdir:..."]` directives
- **GH_TOKEN** always uses the default PAT (broadest scope for `gh repo create` etc.), never per-project PATs

### AGENTS.md (Container vs Repo)
There are TWO different AGENTS.md concepts:
- **This file** (`/AGENTS.md` in repo root): developer guide for working on the CLI tool itself
- **`src/generators/agents-md.ts`**: generates an AGENTS.md that gets COPY'd into the Docker image at `/workspace/AGENTS.md` — this is the AI agent's self-awareness document describing its container environment

### Generated Files
All generated Docker infrastructure lives at `~/.config/remote-opencode-sandbox/instances/<name>/generated/`:
- `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`
- `opencode.docker.json`, `AGENTS.md`
- `.env` (secrets — PATs, tokens)
- `git-credentials/` (per-project credential files + gitconfig)

### Entrypoint Process Supervisor
The generated `docker-entrypoint.sh` is a full bash process supervisor:
- Topological sort for service dependency ordering
- Oneshot services run first (with dependency waiting)
- Daemon services start with PID tracking
- Crash-loop backoff (5 rapid restarts in 120s → 60s cooldown)
- Watchdog loop checks daemon health every 15s
- Graceful SIGTERM/SIGINT propagation
- `remote-opencode` (Discord bot) always starts last

### Compose Generation
`docker-compose.yml` is generated as a raw template string, NOT using the `yaml` library. This is intentional for readability and control over formatting.

## Templates

| Name | Base Image | Key Features |
|------|-----------|--------------|
| `node-basic` | `node:24-bookworm` | Chrome, Bun, `bun install` oneshot, `chrome-devtools` MCP |
| `web-supabase` | `node:24-bookworm` | Chrome, Bun, Supabase CLI, Vite dev server, host Supabase services, `chrome-devtools` + `supabase-local` MCPs |
| `godot-gamedev` | `node:24-bookworm` | Godot 4.6.1, Xvfb, OpenGL/audio deps, `godot` MCP (`@coding-solo/godot-mcp`) |

### Adding a New Template
1. Create `src/templates/<name>.ts` exporting a `Template` object
2. Register it in `src/templates/index.ts` (`TEMPLATES` map)
3. The `Template` interface defines: `docker`, `services`, `envOverrides`, `envRewriteRules`, `mcp`, `ports`, `permission`, `defaultSecrets`

## Common Tasks

### Running the CLI during development
```bash
npx tsx bin/sandbox.ts <command>
# Examples:
npx tsx bin/sandbox.ts build -i default
npx tsx bin/sandbox.ts up -i default
npx tsx bin/sandbox.ts restart-bot -i default
npx tsx bin/sandbox.ts status
```

### Type checking
```bash
npx tsc --noEmit
```

### Rebuilding the Docker container
```bash
npx tsx bin/sandbox.ts build -i default
npx tsx bin/sandbox.ts down -i default
npx tsx bin/sandbox.ts up -i default
# Or in one step:
npx tsx bin/sandbox.ts restart -i default
```

### Testing
```bash
npx tsx test/test-godot-template.ts
```

## Known Gotchas

- `docker compose restart` does NOT reload env vars from `.env` — must `down && up`
- `pkill` via `docker exec` may exit non-zero even on success (process dies before pkill returns) — `restart-bot` handles this
- The `.env` file in generated output contains real GitHub PATs — never commit it
- OpenCode has no built-in "memories" feature — persistent context is via `AGENTS.md` and `instructions` field in `opencode.json`
- `docker compose` commands must run from the `generated/` directory (or use `-f`)
- Boolean flags (`installChrome`, `installBun`, `installSupabaseCli`) are the standard way to toggle common software; `installSteps` is the extensibility escape hatch for anything else

## Instance Configuration Location

```
~/.config/remote-opencode-sandbox/
├── config.json                          # Global: PAT, git identity, SSH
└── instances/
    └── default/
        ├── instance.json                # Instance: env, packages, MCP, services, extraRepos
        ├── projects/
        │   ├── lovable-orphan.json      # Project config
        │   └── resume-builder.json      # Project config
        └── generated/                   # Output from `sandbox build`
            ├── Dockerfile
            ├── docker-compose.yml
            ├── docker-entrypoint.sh
            ├── opencode.docker.json
            ├── AGENTS.md
            ├── .env
            └── git-credentials/
```
