# LLM Stack

OpenWebUI + GPT Researcher (Deep Research) MCP server, managed as a single
module under `~/.os/llm/`.

## Quick Start

```bash
# 1. Base system setup (runs first, installs Docker, Ollama, etc.)
./setup.sh

# 2. LLM stack setup (run after base setup)
./llm/setup.sh

# 3. Register the Deep Research MCP in OpenWebUI (interactive)
./llm/scripts/register-mcp-openwebui.sh
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Host (Pop!_OS)                                     │
│                                                      │
│  ┌──────────┐    ┌───────────────────┐              │
│  │  Ollama   │    │  OpenWebUI        │              │
│  │  :11434   │◄───│  :3000            │              │
│  │  (native)  │    │                   │              │
│  └──────────┘    │  ┌──────────────┐  │              │
│                   │  │ Deep Research │  │              │
│                   │  │ MCP :8000    │  │              │
│                   │  └──────────────┘  │              │
│                   └───────────────────┘              │
│                        Docker containers              │
└─────────────────────────────────────────────────────┘
```

- **Ollama** runs as a native systemd service (GPU-accelerated RTX 3060).
- **OpenWebUI** runs in Docker, connects to Ollama via `host.docker.internal:11434`.
- **GPT Researcher** runs in Docker, exposes an MCP endpoint at `:8000/mcp`.
- OpenWebUI discovers MCP tools via the `/api/v1/configs/tool_servers` API.

## Components

| Component | Port | Directory |
|-----------|------|-----------|
| OpenWebUI | 3000 | `llm/openwebui/` |
| GPT Researcher MCP | 8000 | `llm/gpt-researcher/` |

## Environment Variables

All keys are read from shell environment at container start. No `.env` files.

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `TAVILY_API_KEY` | Yes | — | Tavily search API (GPT Researcher) |
| `OPENAI_API_KEY` | No | — | OpenAI-compatible LLM provider |
| `ANTHROPIC_API_KEY` | No | — | Anthropic LLM provider |
| `OPENAI_BASE_URL` | No | `https://api.openai.com/v1` | LLM endpoint URL |
| `FAST_LLM` | No | `deepseek-v4-pro:cloud` | Fast/cheap model |
| `SMART_LLM` | No | `deepseek-v4-pro:cloud` | Smart/capable model |
| `OLLAMA_HOST` | No | `0.0.0.0` | Ollama bind address |

Set these in your shell (e.g. `~/.secrets` sourced by `~/.bashrc`).

## Shell Commands

| Command | Purpose |
|---------|---------|
| `launch-gpt-research` | Start GPT Researcher stack |
| `launch-gpt-research --fastllm X` | Override fast model |
| `launch-gpt-research --ollama` | Route LLM calls to host Ollama |
| `stop-gpt-research` | Stop GPT Researcher stack |
| `logs-gpt-research` | Follow logs |
| `openwebui` | Start OpenWebUI |
| `openwebui-down` | Stop OpenWebUI |
| `openwebui-logs` | Follow OpenWebUI logs |

## Adding New MCP Servers

Use the generic registration script:

```bash
./llm/scripts/register-mcp-server.sh \
    --name "My Tool" \
    --url http://host.docker.internal:9000/mcp \
    --type mcp \
    --description "What this tool does"
```

For OpenAPI servers:

```bash
./llm/scripts/register-mcp-server.sh \
    --name "Weather API" \
    --url http://host.docker.internal:9000 \
    --type openapi \
    --spec-path /api/openapi.json
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| MCP endpoint not responding | `docker ps` → check gpt-researcher is running |
| OpenWebUI can't reach Ollama | `OLLAMA_HOST=0.0.0.0` must be set for the systemd service |
| OpenWebUI can't reach MCP | Verify `host.docker.internal` resolves inside container: `docker exec openwebui curl -s http://host.docker.internal:8000/mcp` |
| Container rebuild needed | `docker-compose -f ~/.config/gpt-researcher/docker-compose.yml build` |
| Models not showing | Ollama must be running: `systemctl status ollama` |
| Cloud models unauthorized | `gemma4:31b-cloud` requires Ollama Cloud subscription — use local `gemma4:31b` instead |