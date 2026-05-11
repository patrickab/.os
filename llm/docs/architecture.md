# GPT Researcher + OpenWebUI

## Architecture

```
OpenWebUI (:3000)
    ↓ MCP HTTP (SSE transport)
GPT Researcher (:8000)        ←  docker compose stack
    ↓                        ←  ~/.config/gpt-research/.env
Search (Tavily) + LLM APIs   ←  provider-agnostic (OpenAI / Anthropic / Ollama)
```

## Files

| File | Purpose |
|---|---|
| `scripts/setup-gpt-researcher.sh` | Interactive one-shot orchestrator: checks deps, deploys configs, gathers keys, writes .env, pulls images, starts stack |
| `chezmoi/dot_config/gpt-research/docker-compose.yml` | 3 services: openwebui (3000), gpt-researcher (8000), ollama (11434, optional via profile) |
| `chezmoi/dot_config/gpt-research/Dockerfile` | Builds python:3.12-slim → gpt-researcher + mcp[cli] |
| `chezmoi/dot_config/gpt-research/mcp_server.py` | FastMCP server exposing `research` and `quick_research` tools over SSE |
| `chezmoi/dot_config/gpt-research/requirements.txt` | `gpt-researcher>=0.9.0`, `mcp[cli]>=1.0.0` |
| `chezmoi/dot_config/gpt-research/mcp/openwebui-mcp.json` | Pre-built MCP HTTP config for OpenWebUI import |
| `chezmoi/dot_bashrc_appendix_gpt` | Shell functions: `launch-gpt-research`, `stop-gpt-research`, `logs-gpt-research` |
| `ansible/common.yaml` (line 25) | Docker daemon installed via `package` module with ternary name resolution (`docker.io` on Debian, `docker` on Arch) |
| `setup.sh` (lines 53-55) | `systemctl enable --now docker` + `usermod -aG docker` on base system provision |

## Setup Flow

```bash
./setup.sh                          # base system (docker, brew, chezmoi, etc.)
newgrp docker                       # or logout/login – docker group one-time
./scripts/setup-gpt-researcher.sh   # interactive: API keys, models, compose up
```

Post-setup commands:
```bash
launch-gpt-research                 # docker compose up -d
stop-gpt-research                   # docker compose down
logs-gpt-research [service]         # tail logs
```

## Environment Variables (in ~/.config/gpt-research/.env)

| Variable | Required | Purpose |
|---|---|---|
| `TAVILY_API_KEY` | yes | Web search provider |
| `OPENAI_API_KEY` | no | OpenAI API key |
| `ANTHROPIC_API_KEY` | no | Anthropic API key |
| `OPENAI_BASE_URL` | no | Custom endpoint (Ollama, OpenRouter, vLLM, etc.) |
| `FAST_LLM` | no | Cheaper/faster model for quick tasks (e.g. gpt-4o-mini, claude-haiku, qwen3:14b) |
| `SMART_LLM` | no | Capable model for deep research (e.g. gpt-4o, claude-sonnet) |
| `RETRIEVER` | — | Hardcoded to `tavily,mcp` |

## Ports

| Service | Port |
|---|---|
| OpenWebUI | 3000 |
| GPT Researcher MCP | 8000 (Streamable HTTP at `/mcp`) |
| Ollama (optional) | 11434 |

## Design Decisions

- **Docker in base system, not optional** — `common.yaml` declares docker daemon alongside git/curl via `package` module (auto-detects apt/pacman). Single ternary resolves `docker.io` vs `docker` package name. No separate install script.
- **chezmoi for config deployment** — idempotent, version-controlled, integrates with existing dotfile tree. No second deployment mechanism.
- **SSE transport, not stdio** — network-reachable from both containers and OpenWebUI. `host.docker.internal:host-gateway` for cross-container routing.
- **`.env` with chmod 600, not chezmoi encryption** — runtime-generated, gitignored, single-user machine. No decryption passphrase friction.
- **Single bash script, not modularised** — 200 lines. 7 discrete steps with section markers. Sourced helpers (15 lines) sufficient at this scale.
- **Ollama via compose profile** — `--profile ollama` starts/fails the optional service cleanly. No separate compose file.

## Changing Providers / Models

Edit `~/.config/gpt-research/.env` and restart:
```bash
stop-gpt-research && launch-gpt-research
```

Example — switch to OpenRouter:
```env
OPENAI_API_KEY=sk-or-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
FAST_LLM=openai/gpt-4o-mini
SMART_LLM=anthropic/claude-sonnet
```

Example — switch to local Ollama:
```env
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://localhost:11434/v1
FAST_LLM=qwen3:14b
SMART_LLM=qwen3:14b
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "docker not found" | Run `./setup.sh` first |
| "docker daemon not running" | `sudo systemctl enable --now docker` |
| "user not in docker group" | `sudo usermod -aG docker $USER` then `newgrp docker` |
| OpenWebUI can't reach MCP | Verify gpt-researcher container is running: `docker ps`. Endpoint: `http://host.docker.internal:8000/mcp` |
| Tavily quota errors | Check quota at tavily.com, replace key in `.env` |
| Ollama model not found | `ollama pull qwen3:14b` (adjust to your model name) |
| Port collision | Edit `docker-compose.yml` ports, then `stop-gpt-research && launch-gpt-research` |

