export const type = "opencode_local";
export const label = "OpenCode (local)";
export const DEFAULT_OPENCODE_LOCAL_MODEL = "anthropic/claude-sonnet-4-20250514";

export const models = [
  { id: "anthropic/claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "anthropic/claude-opus-4-20250918", label: "Claude Opus 4" },
  { id: "anthropic/claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { id: "openai/gpt-5", label: "GPT-5" },
  { id: "openai/o3", label: "o3" },
  { id: "openai/o4-mini", label: "o4-mini" },
  { id: "google/gemini-3.0-pro", label: "Gemini 3.0 Pro" },
  { id: "google/gemini-3.0-flash", label: "Gemini 3.0 Flash" },
];

export const agentConfigurationDoc = `# opencode_local agent configuration

Adapter: opencode_local

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to stdin prompt at runtime
- model (string, optional): model id in provider/model format (e.g. "anthropic/claude-sonnet-4-20250514")
- variant (string, optional): model variant / reasoning effort (e.g. "high", "max", "minimal")
- promptTemplate (string, optional): run prompt template
- command (string, optional): defaults to "opencode"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables
- agent (string, optional): OpenCode agent name to use

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- OpenCode runs are invoked via \`opencode run --format json\` and prompts are passed as positional args.
- Output is newline-delimited JSON with event types: step_start, text, tool_use, step_finish, error.
- Session resume is supported via \`--session <id> --continue\`.
- Paperclip auto-injects local skills by writing an AGENTS.md-style file into the working directory (if not already present).
`;
