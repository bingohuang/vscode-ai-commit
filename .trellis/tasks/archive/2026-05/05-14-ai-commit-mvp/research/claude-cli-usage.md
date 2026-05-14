# Research: Claude CLI Programmatic Usage

- **Query**: How to invoke the Claude Code CLI (`claude`) programmatically from a Node.js/VS Code extension context
- **Scope**: mixed (internal codebase + external docs)
- **Date**: 2026-05-14

## Findings

### Option 1: CLI Subprocess (`claude -p`) -- Recommended for MVP

#### Basic Invocation

The `-p` / `--print` flag runs Claude non-interactively, prints the response, and exits. This is the simplest approach for a VS Code extension.

```bash
# Basic: prompt as argument
claude -p "generate a commit message for this diff: ..."

# Pipe via stdin
echo "diff content here" | claude -p "generate a commit message for this diff"

# With structured JSON output
claude -p "generate a commit message" --output-format json

# With JSON Schema for validated structured output
claude -p "generate a commit message" \
  --output-format json \
  --json-schema '{"type":"object","properties":{"message":{"type":"string"}},"required":["message"]}'
```

#### Critical CLI Flags

| Flag | Purpose | Notes |
|------|---------|-------|
| `-p` / `--print` | Non-interactive mode | Required for programmatic use |
| `--output-format` | Output format: `text`, `json`, `stream-json` | `json` returns structured result with metadata; `stream-json` requires `--verbose` |
| `--json-schema` | JSON Schema for structured output validation | Response includes `structured_output` field |
| `--system-prompt` | Replace default system prompt entirely | Use for role-specific instructions |
| `--append-system-prompt` | Append to default system prompt | Keeps Claude Code defaults while adding instructions |
| `--model` | Specify model (e.g., `sonnet`, `opus`, full name) | Default depends on user config |
| `--bare` | Minimal mode: skip hooks, LSP, plugins, auto-memory, CLAUDE.md | Recommended for scripted/SDK calls; faster startup; will become default for `-p` in future |
| `--allowedTools` | Auto-approve specific tools (e.g., `"Read,Edit,Bash"`) | Prevents permission prompts in non-interactive mode |
| `--permission-mode` | Baseline permission mode: `default`, `acceptEdits`, `dontAsk`, `bypassPermissions` | `acceptEdits` auto-approves file edits |
| `--max-budget-usd` | Maximum dollar spend cap | Only works with `--print`; returns error if exceeded |
| `--continue` | Continue most recent conversation | Useful for follow-up prompts |
| `--resume <session_id>` | Resume specific conversation by session ID | Capture `session_id` from JSON output |
| `--verbose` | Required for `--output-format stream-json` | Enables streaming event details |
| `--include-partial-messages` | Include partial message chunks in stream | Only with `--print` + `--output-format stream-json` |
| `--mcp-config` | Load MCP servers from JSON files | Advanced: extend with custom tools |
| `--fallback-model` | Fallback model when default is overloaded | Only with `--print` |
| `--no-session-persistence` | Don't save session to disk | Only with `--print` |
| `--tools` | Specify available tools from built-in set | Use `""` to disable all, `"default"` for all |
| `--session-id <uuid>` | Use a specific session ID | Must be valid UUID |

#### JSON Output Format

When using `--output-format json`, the response is a single JSON object:

```json
{
  "type": "result",
  "subtype": "success",           // or "error_max_budget_usd", etc.
  "is_error": false,
  "api_error_status": null,       // HTTP status code on API errors (e.g., 404)
  "duration_ms": 6550,
  "duration_api_ms": 6509,
  "num_turns": 1,
  "result": "The text response from Claude",
  "stop_reason": "end_turn",
  "session_id": "3d612ded-...",
  "total_cost_usd": 0.134542,
  "usage": {
    "input_tokens": 26360,
    "cache_read_input_tokens": 384,
    "output_tokens": 102
  },
  "structured_output": { ... },   // Present when --json-schema is used
  "permission_denials": [],
  "errors": ["..."]               // Present on error
}
```

Key fields:
- `subtype`: `"success"` or error type like `"error_max_budget_usd"`
- `is_error`: boolean
- `api_error_status`: null or HTTP status code (404, 429, etc.)
- `result`: the text response
- `structured_output`: validated JSON matching `--json-schema` (only when schema provided)
- `session_id`: for conversation continuity with `--resume`
- `total_cost_usd`: cost tracking

#### Stream-JSON Output Format

When using `--output-format stream-json --verbose [--include-partial-messages]`, each line is a JSON object representing an event:

```bash
claude -p "Explain recursion" \
  --output-format stream-json \
  --verbose \
  --include-partial-messages
```

Event types include:
- `{"type": "system", "subtype": "hook_started", ...}` -- hook lifecycle
- `{"type": "system", "subtype": "hook_response", ...}` -- hook output
- `{"type": "system", "subtype": "init", ...}` -- session initialization
- `{"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "..."}}}` -- text chunks
- `{"type": "assistant", ...}` -- complete assistant message
- `{"type": "result", ...}` -- final result (same structure as JSON format)

Filter streaming text with jq:
```bash
claude -p "Write a poem" \
  --output-format stream-json --verbose --include-partial-messages | \
  jq -rj 'select(.type == "stream_event" and .event.delta.type? == "text_delta") | .event.delta.text'
```

#### Exit Codes

| Exit Code | Meaning |
|-----------|---------|
| `0` | Success |
| `1` | Error (no input, API error, model not found, budget exceeded, etc.) |

Verified behaviors:
- Empty prompt: exits 1 with error message "Input must be provided either through stdin or as a prompt argument when using --print"
- Invalid model: exits 1 with `is_error: true` and `api_error_status: 404`
- Budget exceeded: exits 1 with `subtype: "error_max_budget_usd"` and `is_error: true`
- Successful call: exits 0

#### stdin Pipe Limit

As of Claude Code v2.1.128, piped stdin is capped at 10MB. For larger inputs, write to a file and reference the file path in the prompt.

#### Recommended Command for AI Commit Extension

```bash
claude --bare -p "Generate a conventional commit message for the following git diff. Only output the commit message, nothing else.

DIFF:
<diff content here>" \
  --output-format json \
  --system-prompt "You are a commit message generator. Generate concise, conventional commit messages following the Conventional Commits specification. Output ONLY the commit message text, no explanations." \
  --no-session-persistence \
  --model sonnet \
  --max-budget-usd 0.05
```

Using `--bare` is recommended for scripted calls because it:
- Skips hooks, skills, plugins, MCP servers that may be configured locally
- Skips auto-memory and CLAUDE.md auto-discovery
- Provides consistent, reproducible results across machines
- Faster startup (no LSP, no plugin sync, no keychain reads for OAuth)

#### Detecting Claude CLI Installation

```typescript
// Method 1: Use child_process.execFile with 'which'
import { execFile } from 'child_process';

function isClaudeInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('which', ['claude'], (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
}

// Method 2: Check known install paths
// macOS/Linux: ~/.local/bin/claude (observed on this system)
// Also check: /usr/local/bin/claude, ~/.npm-global/bin/claude

// Method 3: Run 'claude --version' and check exit code
function getClaudeVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], (err, stdout) => {
      if (err) resolve(null);
      else resolve(stdout.trim()); // e.g., "2.1.138 (Claude Code)"
    });
  });
}
```

Observed binary location on this system: `/Users/bingo/.local/bin/claude`

#### Node.js Integration Pattern

```typescript
import { execFile } from 'child_process';
import * as vscode from 'vscode';

interface ClaudeResult {
  type: 'result';
  subtype: string;
  is_error: boolean;
  result: string;
  structured_output?: unknown;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

async function generateCommitMessage(diff: string): Promise<string> {
  const prompt = `Generate a conventional commit message for this diff:\n\n${diff}`;

  return new Promise((resolve, reject) => {
    const args = [
      '--bare',
      '-p', prompt,
      '--output-format', 'json',
      '--system-prompt', 'You are a commit message generator. Only output the commit message.',
      '--no-session-persistence',
      '--model', 'sonnet',
      '--max-budget-usd', '0.05',
      '--tools', '""'  // Disable all tools - we just want text output
    ];

    execFile('claude', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Claude CLI error: ${err.message}\n${stderr}`));
        return;
      }

      try {
        const result: ClaudeResult = JSON.parse(stdout);
        if (result.is_error) {
          reject(new Error(`Claude API error: ${result.subtype}`));
          return;
        }
        resolve(result.result);
      } catch (parseErr) {
        reject(new Error(`Failed to parse Claude output: ${parseErr}`));
      }
    });
  });
}
```

Alternative using `spawn` for streaming:

```typescript
import { spawn } from 'child_process';

async function generateCommitMessageStreaming(
  diff: string,
  onChunk: (text: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '--bare',
      '-p', `Generate a conventional commit message for this diff:\n\n${diff}`,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--system-prompt', 'You are a commit message generator. Only output the commit message.',
      '--no-session-persistence',
      '--model', 'sonnet',
      '--max-budget-usd', '0.05',
      '--tools', '""'
    ];

    const proc = spawn('claude', args);
    let fullText = '';
    let buffer = '';

    proc.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'stream_event'
              && event.event?.type === 'content_block_delta'
              && event.event?.delta?.type === 'text_delta') {
            const text = event.event.delta.text;
            fullText += text;
            onChunk(text);
          } else if (event.type === 'result') {
            if (event.is_error) {
              reject(new Error(`Claude error: ${event.subtype}`));
              return;
            }
          }
        } catch { /* ignore unparseable lines */ }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      console.error('Claude stderr:', data.toString());
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Claude exited with code ${code}`));
        return;
      }
      resolve(fullText);
    });

    proc.on('error', reject);
  });
}
```

### Option 2: Agent SDK (`@anthropic-ai/claude-agent-sdk`) -- More Capable, More Complex

The Agent SDK provides a proper TypeScript/Python API with structured outputs, streaming, tool approval callbacks, and native message objects. This is the officially recommended approach for programmatic integration.

#### Installation

```bash
npm install @anthropic-ai/claude-agent-sdk
```

Current version: `0.2.141`. The SDK bundles a native Claude Code binary as an optional dependency (e.g., `@anthropic-ai/claude-agent-sdk-darwin-arm64`), so a separate Claude Code installation is not required.

If the package manager skips optional dependencies, the SDK throws `Native CLI binary for not found`. Set `pathToClaudeCodeExecutable` to a separately installed `claude` binary instead.

#### Authentication

The SDK requires `ANTHROPIC_API_KEY` by default. It also supports:
- Amazon Bedrock: `CLAUDE_CODE_USE_BEDROCK=1` + AWS credentials
- Google Vertex AI: `CLAUDE_CODE_USE_VERTEX=1` + Google Cloud credentials
- Microsoft Azure: `CLAUDE_CODE_USE_FOUNDRY=1` + Azure credentials

**Important licensing note**: Unless previously approved by Anthropic, third-party developers may NOT offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. API key authentication must be used.

#### Basic TypeScript Usage

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Generate a conventional commit message for this diff",
  options: {
    systemPrompt: { type: "custom", text: "You are a commit message generator." },
    outputFormat: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          message: { type: "string" },
          type: { type: "string", enum: ["feat", "fix", "chore", "docs", "refactor", "test"] },
          scope: { type: "string" },
          breaking: { type: "boolean" }
        },
        required: ["message", "type"]
      }
    },
    allowedTools: [],  // No tools needed for commit message generation
    maxTurns: 1,
    model: "sonnet"
  }
})) {
  if (message.type === "result" && message.subtype === "success" && message.structured_output) {
    console.log(message.structured_output);
  }
}
```

#### Streaming with SDK

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Generate a commit message",
  options: {
    includePartialMessages: true,
    allowedTools: []
  }
})) {
  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      process.stdout.write(event.delta.text);
    }
  }
}
```

#### Pre-warming with `startup()`

The SDK provides a `startup()` function to pre-warm the subprocess:

```typescript
import { startup } from "@anthropic-ai/claude-agent-sdk";

// Pay startup cost upfront (e.g., on extension activate)
const warm = await startup({
  options: { maxTurns: 1, model: "sonnet" }
});

// Later, when a prompt is ready - this is immediate
for await (const message of warm.query("Generate a commit message")) {
  // ...
}
```

#### SDK vs CLI Comparison for VS Code Extension

| Aspect | CLI (`claude -p`) | Agent SDK (`@anthropic-ai/claude-agent-sdk`) |
|--------|-------------------|---------------------------------------------|
| Setup complexity | Low (just need `claude` in PATH) | Medium (npm dependency, binary bundling) |
| Dependency | Requires Claude Code CLI installed | Bundles its own binary (optional dep) |
| Auth with existing subscription | Yes (OAuth/subscription works) | No (requires ANTHROPIC_API_KEY) |
| Structured output | `--json-schema` on CLI | `outputFormat` in options |
| Streaming | `--output-format stream-json --verbose` | `includePartialMessages: true` |
| Error handling | Parse JSON + exit codes | Typed message objects |
| Pre-warming | Not supported | `startup()` function |
| Binary size | Zero (uses existing install) | ~50-100MB bundled binary |
| License constraint | Users authenticate themselves | Must use API key (no claude.ai login) |

### Option 3: Anthropic API Directly (`@anthropic-ai/sdk`)

Using the Anthropic TypeScript SDK directly provides full control but requires users to have an API key.

```bash
npm install @anthropic-ai/sdk
```

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

const msg = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Generate a commit message for: ..." }],
  system: "You are a commit message generator."
});
```

This approach:
- Has no Claude Code dependency at all
- Requires each user to have their own API key
- Cannot leverage the user's existing Claude subscription (Pro/Max/Teams)
- Lighter weight, no subprocess spawning
- Full control over request parameters

### Authentication Considerations

#### How Claude CLI Authentication Works

The `claude` CLI authenticates via:
1. **OAuth token** (default for individual users): Stored in macOS Keychain or `~/.claude/.credentials.json`. This works with Claude Pro/Max/Teams subscriptions.
2. **ANTHROPIC_API_KEY**: Direct API key in environment variable.
3. **Cloud provider credentials**: Bedrock, Vertex, Foundry.

Current system auth status: `loggedIn: true, authMethod: oauth_token, apiProvider: firstParty`

#### For the VS Code Extension

The key question is: can the extension use the user's existing Claude Code authentication?

**CLI approach (`claude -p`)**: YES. The subprocess inherits the user's CLI authentication automatically. If they're logged in to Claude Code, it just works.

**Agent SDK approach**: NO for OAuth. The SDK requires `ANTHROPIC_API_KEY` or cloud provider credentials. Per Anthropic's terms: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products."

**Direct API approach**: NO. Requires separate API key setup.

This is a critical factor: for the MVP where the goal is "users don't need separate API keys," the CLI subprocess approach is the only option that works with existing Claude subscriptions without violating terms of service.

### Rate Limiting and Costs

- **Subscription plans**: Starting June 15, 2026, Agent SDK and `claude -p` usage on subscription plans will draw from a new monthly Agent SDK credit, separate from interactive usage limits.
- **Cost tracking**: The JSON output includes `total_cost_usd` field. Can use `--max-budget-usd` to cap spending per call.
- **No explicit rate limiting on CLI**: The CLI is subject to the same API rate limits as the underlying authentication method.

### Timeout Considerations

- CLI subprocess calls can take 5-30+ seconds depending on prompt complexity and model load
- Use `maxBuffer` option in Node.js `execFile` (default 200KB may be insufficient for large outputs)
- Consider setting a timeout on the subprocess (e.g., 60 seconds)
- The `--max-budget-usd` flag can serve as an indirect timeout mechanism

### Files Found

| File Path | Description |
|---|---|
| `src/extension.ts` | Current VS Code extension entry point (hello world only) |
| `package.json` | Extension manifest; has `claude` in keywords already |
| `.trellis/spec/frontend/index.md` | Frontend spec index |
| `.trellis/spec/frontend/directory-structure.md` | Directory structure spec |

### External References

- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) -- Official docs for `claude -p` usage, all CLI flags, examples
- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) -- SDK architecture, capabilities, authentication
- [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript) -- Full API: `query()`, `startup()`, `tool()`, `Options` type
- [Get structured output from agents](https://code.claude.com/docs/en/agent-sdk/structured-outputs) -- JSON Schema, Zod, structured output configuration
- [Stream responses in real-time](https://code.claude.com/docs/en/agent-sdk/streaming-output) -- `StreamEvent`, `includePartialMessages`, message flow
- [Authentication](https://code.claude.com/docs/en/authentication) -- All auth methods, credential management, team setup
- [@anthropic-ai/claude-agent-sdk on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) -- npm package (v0.2.141)
- [@anthropic-ai/claude-code on npm](https://www.npmjs.com/package/@anthropic-ai/claude-code) -- CLI package (v2.1.141)
- [Claude Code GitHub repo](https://github.com/anthropics/claude-code) -- Source code, issues

### Related Specs

- `.trellis/spec/frontend/directory-structure.md` -- May need updating to add claude integration module
- `.trellis/spec/frontend/component-guidelines.md` -- May reference extension architecture patterns

## Caveats / Not Found

1. **Agent SDK + OAuth limitation**: The Agent SDK cannot use a user's existing Claude subscription (OAuth) for authentication. This is a significant constraint. The CLI subprocess approach is the only way to leverage existing subscriptions without requiring a separate API key.

2. **Licensing concern for distribution**: If the extension is distributed to other users, they must have Claude Code installed and authenticated. There is no way to bundle authentication. The extension should detect missing CLI and guide users to install it.

3. **`--bare` mode + auth**: In bare mode, OAuth and keychain reads are skipped. Authentication must come from `ANTHROPIC_API_KEY` or `apiKeyHelper`. This means `--bare` (recommended for scripted calls) CANNOT use the user's subscription auth. For the extension, you should NOT use `--bare` if you want to leverage existing subscription authentication.

4. **Agent SDK credit changes**: Starting June 15, 2026, subscription plan users get a separate monthly Agent SDK credit. The impact on `claude -p` usage under a subscription is not fully clear -- it may affect how much users can use the extension.

5. **Stream-json requires --verbose**: The `--output-format stream-json` flag requires `--verbose` to work, which is not obvious from the help text.

6. **stdin 10MB cap**: Piped stdin is capped at 10MB (as of v2.1.128). For very large diffs, consider writing to a temp file and referencing in the prompt.

7. **No official VS Code extension API**: There is no official VS Code extension API or library from Anthropic. The CLI subprocess or Agent SDK are the only programmatic interfaces.

8. **Hooks in non-bare mode**: Without `--bare`, `claude -p` loads all hooks, skills, plugins, MCP servers configured in the working directory or `~/.claude`. This can add significant latency (several seconds observed in testing) and inject unwanted context (as seen in test outputs where "Trellis SessionStart" was injected). Using `--bare` avoids this but loses subscription auth.
