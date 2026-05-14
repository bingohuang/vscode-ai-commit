# Research: Calling Anthropic API Directly from VS Code Extension

- **Query**: How to use `@anthropic-ai/sdk` or raw HTTP to call the Anthropic Messages API directly from a VS Code extension (Node.js), bypassing the Claude CLI, for commit message generation. Including prompt caching, performance comparison, API key management, and model selection.
- **Scope**: Mixed (internal codebase analysis + external SDK docs)
- **Date**: 2026-05-14

## Findings

### 1. Current Architecture (Internal)

The extension currently shells out to the Claude CLI (`claude` binary) via `child_process.execFile`. The full flow is in `src/services/claude-cli.ts`:

| File Path | Description |
|---|---|
| `src/services/claude-cli.ts` | Claude CLI integration: finds binary, writes prompt to temp file, pipes via shell, parses JSON output |
| `src/services/git-service.ts` | Git diff extraction using VS Code's built-in Git extension API |
| `src/commands/generate.ts` | Command handler: orchestrates git repo -> diff -> CLI call -> fill input box |
| `src/extension.ts` | Entry point, registers the `vscode-ai-commit.generate` command |

Current CLI invocation pattern (from `claude-cli.ts:152-248`):
- Writes the user prompt to a temp file
- Executes `claude --print --output-format json --system-prompt "..." --dangerously-skip-permissions`
- Pipes the temp file content via `cat` to stdin
- Parses the JSON result to extract the commit message text
- Uses a 120-second timeout and 10MB max buffer

Key observations about the current approach:
- The CLI spawns a full process with shell, login shell sourcing, environment loading
- The system prompt is ~400 chars, the commit prompt template is ~200 chars
- The diff can vary from small to very large
- The CLI binary must be discovered on the system PATH

---

### 2. Anthropic SDK for Node.js (`@anthropic-ai/sdk`)

#### Installation

```bash
npm install @anthropic-ai/sdk
```

The SDK works in any Node.js environment, including VS Code extensions. The extension's `tsconfig.json` uses `module: "Node16"` and `target: "ES2022"`, which is compatible with the SDK.

#### Minimal Code for a Single Message Completion

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: 'sk-ant-...',  // or read from env/config
});

const response = await client.messages.create({
  model: 'claude-haiku-4-5',
  max_tokens: 1024,
  system: 'You are a commit message generator...',
  messages: [
    { role: 'user', content: 'Generate a conventional commit message for this diff:\n...' }
  ],
});

// Extract text from response
const text = response.content
  .filter(block => block.type === 'text')
  .map(block => block.text)
  .join('');
```

#### With Prompt Caching

Prompt caching lets you cache the stable system prompt across requests. The system prompt is the same for every commit message generation call, so it benefits from caching.

```typescript
const response = await client.messages.create({
  model: 'claude-haiku-4-5',
  max_tokens: 1024,
  system: [
    {
      type: 'text',
      text: 'You are a commit message generator...',  // stable across requests
      cache_control: { type: 'ephemeral' },  // cache for 5 minutes
    },
  ],
  messages: [
    { role: 'user', content: 'Generate a conventional commit message for:\n...' }
  ],
});

// Check cache performance
console.log(response.usage.cache_creation_input_tokens);  // tokens written (~1.25x cost)
console.log(response.usage.cache_read_input_tokens);      // tokens served from cache (~0.1x cost)
```

There is also a top-level shorthand that auto-caches the last cacheable block:

```typescript
const response = await client.messages.create({
  model: 'claude-haiku-4-5',
  max_tokens: 1024,
  cache_control: { type: 'ephemeral' },  // auto-caches last cacheable block
  system: 'You are a commit message generator...',
  messages: [{ role: 'user', content: '...' }],
});
```

#### Error Handling with Typed Exceptions

```typescript
import Anthropic from '@anthropic-ai/sdk';

try {
  const response = await client.messages.create({ ... });
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError) {
    // Invalid API key
  } else if (error instanceof Anthropic.RateLimitError) {
    // Too many requests - retry later
  } else if (error instanceof Anthropic.APIError) {
    // General API error with status code
  }
}
```

---

### 3. Prompt Caching Details

#### How It Works

- **Prefix match**: The cache is based on the exact bytes of the rendered prompt prefix. Any byte change anywhere in the prefix invalidates everything after it.
- **Render order**: `tools` -> `system` -> `messages`. A breakpoint on the last system block caches both tools and system together.
- **Max 4 breakpoints** per request.
- **TTL**: Default 5 minutes. Can be extended to 1 hour with `cache_control: { type: 'ephemeral', ttl: '1h' }`.

#### Minimum Token Requirements (per model)

| Model | Minimum Cacheable Prefix |
|---|---:|
| Opus 4.7, Opus 4.6, Opus 4.5, Haiku 4.5 | 4096 tokens |
| Sonnet 4.6 | 2048 tokens |
| Sonnet 4.5, Sonnet 4 | 1024 tokens |

For commit message generation, the system prompt (~400 chars / ~100 tokens) is below the minimum. To make caching effective, you would need to pad the system prompt to at least ~1024 tokens (for Sonnet-class models) or accept that small prompts won't cache. One approach: include detailed conventional commit examples in the system prompt to reach the threshold.

#### Economics

- Cache writes cost **1.25x** base input price (5-min TTL) or **2x** (1-hour TTL)
- Cache reads cost **~0.1x** base input price
- Break-even at 2 identical requests for 5-min TTL, 3 for 1-hour TTL

#### Relevance to This Extension

For this use case, the system prompt is short (~400 chars) and below the minimum cacheable prefix on all models. Caching the system prompt alone will NOT work. However, if the system prompt is expanded with detailed examples and guidelines to reach 1024+ tokens, it becomes cacheable on Sonnet models. The diff content changes every request, so only the system prompt portion can be cached.

---

### 4. HTTP Direct Call Alternative (No SDK)

You can call the Anthropic Messages API directly using `fetch()` or Node.js `https` module. This avoids the SDK dependency entirely.

#### Using Node.js `fetch()` (available in Node 18+, which VS Code ships with)

```typescript
async function callAnthropicAPI(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  model: string = 'claude-haiku-4-5',
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`API error ${response.status}: ${error.error?.message}`);
  }

  const data = await response.json();

  // Extract text from content blocks
  return data.content
    .filter((block: { type: string }) => block.type === 'text')
    .map((block: { text: string }) => block.text)
    .join('');
}
```

#### Minimal Request Format

```json
POST https://api.anthropic.com/v1/messages

Headers:
  content-type: application/json
  x-api-key: sk-ant-...
  anthropic-version: 2023-06-01

Body:
{
  "model": "claude-haiku-4-5",
  "max_tokens": 1024,
  "system": "You are a commit message generator...",
  "messages": [
    { "role": "user", "content": "Generate a commit message for:\n..." }
  ]
}
```

#### With Prompt Caching via Raw HTTP

```json
{
  "model": "claude-haiku-4-5",
  "max_tokens": 1024,
  "system": [
    {
      "type": "text",
      "text": "You are a commit message generator...",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

#### SDK vs Raw HTTP: Tradeoffs for This Extension

| Aspect | SDK (`@anthropic-ai/sdk`) | Raw `fetch()` |
|---|---|---|
| Dependency size | ~2MB (bundled) | 0 (built-in) |
| Type safety | Full TypeScript types | Manual typing needed |
| Retry logic | Built-in (429, 5xx auto-retry) | Must implement manually |
| Streaming support | Built-in helpers | Manual SSE parsing |
| Error classes | Typed exceptions | Manual status code checks |
| Maintenance burden | Low (SDK handles changes) | Higher (must track API changes) |
| Bundle impact on extension | Adds to `.vsix` size | No additional size |

For a simple single-request call (no streaming, no tool use, no multi-turn), raw `fetch()` is viable. The SDK adds convenience but also bundle size.

---

### 5. Performance Comparison: Direct API vs Claude CLI

#### Current CLI Path Latency Breakdown

| Step | Estimated Time |
|---|---|
| Find CLI binary (cached) | ~1ms |
| Write prompt to temp file | ~1ms |
| Spawn shell process (`/bin/bash -l -c ...`) | ~50-200ms |
| Shell init (login shell sources `.bashrc`/`.zshrc`) | ~100-500ms |
| CLI startup (Node.js process init) | ~200-500ms |
| CLI internal setup (load config, auth) | ~100-300ms |
| API call (network to Anthropic) | ~500-2000ms |
| CLI output serialization | ~10ms |
| JSON parse of CLI output | ~1ms |
| **Total estimated** | **~960ms - 3.5s overhead + API time** |

#### Direct API Path Latency Breakdown

| Step | Estimated Time |
|---|---|
| Create HTTP request (in-process) | ~1ms |
| Network roundtrip to Anthropic API | ~500-2000ms |
| Parse JSON response | ~1ms |
| **Total estimated** | **~500ms - 2s** |

#### Estimated Savings

- **Overhead removed**: ~0.5s - 1.5s per invocation (process spawn, shell init, CLI startup)
- **For small diffs** (where API time is ~0.5s), direct API can be **2-3x faster** overall
- **For large diffs** (where API time dominates), the relative improvement is smaller but still measurable
- **No temp file I/O**: Eliminates a file write + cleanup per invocation
- **No `--dangerously-skip-permissions`**: The CLI flag is a security concern; direct API has no such requirement

#### Additional Performance Notes

- The CLI uses `--output-format json` which adds serialization overhead
- The CLI creates a session (`--session-id`) which the API does not need for single requests
- The CLI reports cost/usage data, adding response size
- Direct API allows setting `max_tokens: 256` for commit messages (short output), further reducing latency

---

### 6. API Key Management

There are three viable approaches for the extension:

#### Option A: Environment Variable (`ANTHROPIC_API_KEY`)

```typescript
const apiKey = process.env.ANTHROPIC_API_KEY;
```

- Pros: Standard convention, works out of the box for users who already have it set
- Cons: VS Code may not inherit shell env vars depending on how it was launched (macOS Launchpad vs terminal)
- Precedent: Most Anthropic SDKs default to this

#### Option B: Read from Claude CLI Config

Claude CLI stores its configuration in `~/.claude/`. The API key may be accessible from the CLI's own config files, but this is an implementation detail of the CLI and not a public API. Not recommended as a primary source.

#### Option C: User Configures in VS Code Settings

```json
// package.json contributes.configuration
{
  "aiCommit.anthropicApiKey": {
    "type": "string",
    "default": "",
    "description": "Anthropic API key for direct API access. Leave empty to use ANTHROPIC_API_KEY env var."
  }
}
```

```typescript
// Reading the key with fallback chain
function getApiKey(): string | null {
  const config = vscode.workspace.getConfiguration('aiCommit');
  const configuredKey = config.get<string>('anthropicApiKey');
  if (configuredKey) return configuredKey;

  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;

  return null;
}
```

- Pros: User-friendly, visible in VS Code settings UI
- Cons: Stores API key in VS Code settings (plaintext in `settings.json`)

#### Recommended Approach: Layered Fallback

1. Check VS Code setting `aiCommit.anthropicApiKey` first
2. Fall back to `ANTHROPIC_API_KEY` environment variable
3. If neither is set, prompt the user to configure one

For the VS Code setting, consider using `SecretStorage` API instead of plain settings to avoid storing the key in plaintext:

```typescript
// VS Code SecretStorage (encrypted, per-machine)
const secretStorage = context.secrets;
await secretStorage.store('anthropicApiKey', key);
const apiKey = await secretStorage.get('anthropicApiKey');
```

This is the most secure approach for a VS Code extension.

---

### 7. Model Selection for Commit Message Generation

#### Current Models (as of 2026-04-15)

| Model | Model ID | Context | Input $/1M | Output $/1M | Max Output |
|---|---|---|---|---|---|
| Claude Opus 4.7 | `claude-opus-4-7` | 1M | $5.00 | $25.00 | 128K |
| Claude Opus 4.6 | `claude-opus-4-6` | 1M | $5.00 | $25.00 | 128K |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | $3.00 | $15.00 | 64K |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | $1.00 | $5.00 | 64K |

#### Haiku vs Sonnet for Commit Messages

| Aspect | Haiku 4.5 | Sonnet 4.6 |
|---|---|---|
| **Speed** | Fastest (typically 0.3-0.8s for short outputs) | Fast (typically 0.5-1.5s for short outputs) |
| **Cost per request** | ~$0.001-0.003 (small diffs) | ~$0.003-0.01 (small diffs) |
| **Commit message quality** | Good for simple diffs, may miss nuance in complex changes | Better at understanding complex changes, cross-file implications |
| **Conventional commit compliance** | Good with clear instructions | Excellent, follows format more reliably |
| **Complex refactors** | May produce generic messages | Better at summarizing multi-file changes |
| **Best for** | Quick iteration, small/medium diffs | Large diffs, complex changes, when quality matters |

#### Recommendation

**Haiku 4.5 is the best default** for commit message generation:
- The task is constrained (follow a format, summarize a diff)
- The output is short (one line + optional body)
- Speed matters more than deep reasoning
- Cost is minimal (~$0.001 per call)

**Sonnet 4.6 as an upgrade option** for users who want higher quality on complex diffs.

The extension should default to Haiku and allow users to select Sonnet or Opus via a VS Code setting:

```json
{
  "aiCommit.model": {
    "type": "string",
    "default": "claude-haiku-4-5",
    "enum": ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-7"],
    "description": "Claude model to use for commit message generation."
  }
}
```

---

### 8. Integration Pattern for VS Code Extension

Here is the architectural pattern for replacing the CLI call with a direct API call. This is not implementation code, but a structural reference.

```
Current flow:
  generate.ts -> claude-cli.ts -> execFile('claude') -> API

Proposed flow:
  generate.ts -> anthropic-api.ts -> fetch('https://api.anthropic.com/v1/messages') -> API
```

The `anthropic-api.ts` service would:
1. Read API key from VS Code SecretStorage / env var
2. Read model from VS Code settings
3. Build the request with the existing system prompt and diff
4. Call the Messages API (via SDK or raw fetch)
5. Extract the commit message text from the response
6. Return the message string (same interface as current `generateCommitMessage()`)

The existing `claude-cli.ts` can be kept as a fallback for users who prefer CLI mode.

---

## Caveats / Not Found

- **Exact CLI overhead timing**: The estimates above are based on general knowledge of process spawn costs and CLI startup patterns. Actual measurements would require benchmarking in the target environment.
- **Claude CLI config format**: The structure of `~/.claude/` config files is not publicly documented as a stable API. Reading API keys from there is fragile.
- **SDK bundle size impact**: The `@anthropic-ai/sdk` package adds to the `.vsix` extension size. For a lightweight extension, raw `fetch()` may be preferable. The exact size impact depends on tree-shaking and bundling configuration.
- **VS Code `fetch()` availability**: VS Code's Node.js runtime includes `fetch()` globally since Node 18. The extension targets VS Code ^1.110.0, which ships with Node 18+, so `fetch()` is available.
- **Prompt caching may not help much**: The system prompt is only ~400 chars / ~100 tokens, which is below the 1024-token minimum for Sonnet-class models. To benefit from caching, the system prompt would need to be expanded significantly.
- **Rate limits**: Direct API access is subject to Anthropic's rate limits (per-tier). The CLI may have its own rate limit pool. Users on free tiers may hit limits faster with direct API calls.

## Related Specs

- `.trellis/spec/` -- not examined in this research task

## External References

- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) -- official SDK for Node.js
- [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) -- REST API reference
- [Prompt Caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) -- caching documentation
- [VS Code SecretStorage API](https://code.visualstudio.com/api/references/vscode-api#SecretStorage) -- secure key storage
