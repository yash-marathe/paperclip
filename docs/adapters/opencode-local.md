---
title: OpenCode Local
summary: OpenCode local adapter setup and configuration
---

The `opencode_local` adapter runs the [OpenCode](https://opencode.ai) CLI locally. It supports session persistence, multi-provider model selection, and skills injection through the prompt.

## Prerequisites

- OpenCode CLI installed (`opencode` command available)
- At least one LLM provider configured (via `opencode auth login` or API key environment variables)

## Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | string | Yes | Working directory for the agent process (absolute path; created automatically if missing when permissions allow) |
| `model` | string | No | Model in `provider/model` format (e.g. `anthropic/claude-sonnet-4-20250514`) |
| `variant` | string | No | Model variant / reasoning effort (`minimal`, `low`, `medium`, `high`, `max`) |
| `agent` | string | No | OpenCode agent name to use |
| `promptTemplate` | string | No | Prompt used for all runs |
| `instructionsFilePath` | string | No | Absolute path to an instructions file injected into the prompt |
| `env` | object | No | Environment variables (supports secret refs) |
| `timeoutSec` | number | No | Process timeout (0 = no timeout) |
| `graceSec` | number | No | Grace period before force-kill |
| `command` | string | No | CLI command (defaults to `opencode`) |
| `extraArgs` | string[] | No | Additional CLI arguments |

## Multi-Provider Support

OpenCode supports multiple LLM providers (Anthropic, OpenAI, Google, and more). The model field uses `provider/model` format, allowing you to select any supported model across providers.

## Session Persistence

OpenCode uses session IDs for conversation continuity. The adapter serializes and restores sessions across heartbeats via the `--session` and `--continue` flags.

## Skills Injection

The adapter loads Paperclip skills from the repository's `skills/` directory and injects them as additional context in the prompt. This allows the agent to discover and use Paperclip coordination skills.

## Environment Test

The environment test checks:

- OpenCode CLI is installed and accessible
- Working directory is absolute and available (auto-created if missing and permitted)
- Authentication signal (checks for `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, or `OPENCODE_API_KEY`)
- A live hello probe (`opencode run --format json "Respond with hello."`) to verify the CLI can actually run
