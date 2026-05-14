# Research: Claude CLI Invocation Speed Optimization

- **Query**: How to optimize Claude Code CLI invocation speed for generating git commit messages (from 10+ seconds to under 5 seconds)
- **Scope**: Mixed (internal code analysis + external tool/API research)
- **Date**: 2026-05-14

## Findings

### 1. Claude CLI Flags & Modes

#### `--bare` Flag (CRITICAL: 3-5x speedup)

The `--bare` flag is the single most impactful optimization. It skips hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery. Sets `CLAUDE_CODE_SIMPLE=1` internally.

**Benchmark results (simple prompt "say just: hello"):**

| Configuration | Wall Time | Notes |
|---|---|---|
| Current (no `--bare`, default model) | ~9-16s | What the extension currently does |
| `--bare`, haiku model, text output | ~3s | Best CLI option |
| `--bare`, haiku model, JSON output | ~2.5s | JSON parsing overhead is negligible |
| `--bare`, haiku, effort low, text | ~2s | Fastest CLI configuration |
| `CLAUDE_CODE_SIMPLE=1` env only, haiku | ~1.9s | Even faster than `--bare` flag |

**Realistic commit workload benchmark (with system prompt + diff):**

| Configuration | Wall Time |
|---|---|
| Direct API call (curl, haiku) | ~0.7s |
| CLI `--bare` + haiku + text | ~4.9s |
| CLI without `--bare` + default model | ~10-16s |

#### `--output-format` (text vs json)

`--output-format text` is marginally faster than `json` because the JSON response includes metadata (session_id, cost, usage, etc.). However, the difference is ~0.5s at most. If you need structured data, JSON is fine. If you only need the message text, use `text`.

JSON output provides useful metadata in the response:
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 2114,
  "duration_api_ms": 2099,
  "result": "fix: add missing Node.js imports",
  "session_id": "...",
  "total_cost_usd": 0.00105,
  "usage": {"input_tokens": 1, "output_tokens": 80, "cache_read_input_tokens": 6509},
  "modelUsage": {"claude-haiku-4-5-20251001": {...}}
}
```

#### `--model` (haiku vs default)

Using `--model haiku` (maps to `claude-haiku-4-5-20251001` based on settings) is significantly faster than the default model (sonnet/glm-4.7). For commit message generation, haiku is sufficient quality.

Note: The user's settings map models to BigModel (open.bigmodel.cn):
- `ANTHROPIC_DEFAULT_SONNET_MODEL`: glm-4.7
- `ANTHROPIC_DEFAULT_OPUS_MODEL`: glm-5.1
- `ANTHROPIC_SMALL_FAST_MODEL`: glm-4.7

Haiku resolves to `claude-haiku-4-5-20251001` and is still routed through the same proxy.

#### `--effort` Flag

`--effort low` reduces the model's reasoning effort, providing ~0.5-1s speedup. Available values: `low`, `medium`, `high`, `max`. For simple commit message generation, `low` is appropriate.

#### `--max-tokens` Flag

NOT SUPPORTED. `--max-tokens` is not a valid Claude CLI flag (returns "error: unknown option '--max-tokens'"). The CLI does not expose this Anthropic API parameter.

#### `--max-budget-usd` Flag

Limits total dollar spend per invocation. Not a speed optimization but useful for cost control with `--print` mode.

#### `--json-schema` Flag

Provides structured output validation. Tested working:
```
--json-schema '{"type":"object","properties":{"type":{"type":"string","enum":["feat","fix",...]},"scope":{"type":"string"},"description":{"type":"string"}},"required":["type","description"]}'
```
This adds ~0.5s overhead but guarantees structured output format. No measurable speed difference from plain text output.

#### `--no-session-persistence` Flag

Prevents session from being saved to disk. Could reduce I/O overhead slightly. Only works with `--print`.

### 2. Claude API Direct Call vs CLI

#### Overhead Breakdown

| Approach | Time (simple prompt) | Time (realistic workload) |
|---|---|---|
| Direct HTTP API (curl) | ~0.5-0.9s | ~0.7-1.0s |
| Claude CLI `--bare --model haiku` | ~2-3s | ~4.9s |
| Claude CLI (current implementation) | ~9-16s | ~10-16s |

The CLI overhead comes from:
1. Node.js process startup (~0.5-1s)
2. Module loading and initialization (~0.5-1s)
3. Auth token resolution (~0.5s, unless `--bare` which skips keychain)
4. CLAUDE.md discovery and loading (skipped with `--bare`)
5. Hook execution (skipped with `--bare`)
6. Plugin/LSP initialization (skipped with `--bare`)
7. API call itself (~1-3s depending on model)

#### Direct SDK Approach

Using `@anthropic-ai/sdk` (v0.96.0, MIT license) eliminates ALL CLI overhead:

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'https://open.bigmodel.cn/api/anthropic', // or default Anthropic endpoint
});

const message = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 200,
  system: 'You are a commit message generator...',
  messages: [{ role: 'user', content: `Generate a commit message for:\n${diff}` }],
});
```

**Advantages of SDK over CLI:**
- No process spawn overhead (~1-2s saved)
- No Node.js cold start (~0.5-1s saved)
- Direct control over `max_tokens` parameter (limit to 200 for commit messages)
- Supports prompt caching natively
- Supports streaming for progressive output
- Smaller dependency footprint
- No temp file needed (diff passed directly as message content)

**Advantages of CLI over SDK:**
- Handles authentication (OAuth, API key, keychain) automatically
- Works with user's existing Claude Code setup
- No additional npm dependency
- No API key management needed

#### HTTP fetch (no SDK) Approach

For maximum minimalism, raw HTTP works too:
```typescript
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: 'user', content: diff }],
  }),
});
```
This has zero additional dependencies but requires manual auth management and response parsing.

### 3. Prompt Caching

#### Anthropic API Prompt Caching

Prompt caching is supported on all active Claude models. Two modes:

**Automatic caching**: Add `cache_control: {"type": "ephemeral"}` at the top level of the request. The system automatically applies the cache breakpoint to the last cacheable block.

```typescript
const message = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 200,
  cache_control: { type: 'ephemeral' },
  system: SYSTEM_PROMPT,  // This gets cached
  messages: [{ role: 'user', content: diff }],
});
```

**Explicit caching**: Place `cache_control` directly on individual content blocks:
```typescript
system: [{
  type: 'text',
  text: SYSTEM_PROMPT,
  cache_control: { type: 'ephemeral' },
}]
```

**Pricing:**
- Cache write tokens: 2x base input token price
- Cache read tokens: 0.1x base input token price (10x cheaper!)
- Minimum token threshold: ~1024 tokens for the cached content
- Cache TTL: 5 minutes (default) or 1 hour

**Relevance to commit message generation:**
- The system prompt (~100-200 tokens) is too short for caching minimums alone
- BUT the system prompt + diff prefix could reach the threshold if the diff is large enough
- For repeated invocations within 5 minutes with the same system prompt, caching could reduce cost and latency
- The Claude CLI already uses prompt caching internally (observed `cache_read_input_tokens: 6509` in JSON output)

#### Claude CLI Caching

The Claude CLI automatically uses prompt caching. In JSON output responses, you can see:
```json
"usage": {
  "input_tokens": 1,
  "cache_read_input_tokens": 6509
}
```
This means the CLI is already caching its internal system prompt + tools. The user-provided system prompt via `--system-prompt` is NOT separately cached between invocations since each `--print` invocation creates a fresh context.

### 4. Diff Preprocessing

#### Current Implementation

The extension currently uses `git diff --cached --unified=3` (or `git diff --unified=3` for unstaged). No preprocessing, no filtering.

File: `src/services/git-service.ts`, line 47-72.

#### aicommits Strategy

Source: `github.com/Nutlope/aicommits`

- Uses `git diff --cached --diff-algorithm=minimal` (minimal diff algorithm)
- Excludes lock files from diff: `package-lock.json`, `pnpm-lock.yaml`, `*.lock`
- If all staged files are lock files, includes them anyway
- If non-lock files exist, lock files are excluded
- Gets file list first, then generates diff for specific files only
- Supports `--excludeFiles` parameter for user-specified exclusions
- Uses `tiktoken` for token counting to chunk large diffs
- Default timeout: 10s (non-ollama), 30s (ollama)
- Uses Vercel AI SDK (`ai` package) with `@ai-sdk/openai-compatible` for provider abstraction
- Temperature: 0.2 for commit shortening, varies for generation

#### opencommit Strategy

Source: `github.com/di-sukharev/opencommit`

- Excludes binary/media files from diff: `.lock`, `-lock.`, `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`
- Uses `.opencommitignore` file (like .gitignore for commit messages)
- Uses `tiktoken` (cl100k_base encoding) for token counting
- Has `mergeDiffs` utility that merges per-file diffs up to a token limit
- Configurable `OCO_TOKENS_MAX_INPUT` and `OCO_TOKENS_MAX_OUTPUT`
- Uses OpenAI SDK directly
- Provides token-aware chunking: splits diffs into chunks that fit within model context

#### Diff Optimization Strategies Summary

1. **Exclude binary/lock files**: Filter out `.lock`, `*-lock.*`, `.svg`, `.png`, `.jpg`, images
2. **Use `--diff-algorithm=minimal`**: Produces smaller diffs
3. **Limit context lines**: `--unified=3` (current) or even `--unified=0` for extreme cases
4. **Token-aware chunking**: Count tokens and truncate/chunk if exceeding model limits
5. **File-level summarization**: For large diffs, summarize per-file changes before sending to model
6. **Strip diff headers**: Remove `index abc123..def456 100644` lines (hash + mode) that add no value
7. **Stat-based fallback**: Use `git diff --stat` for extremely large changes, then only include actual diff for key files

### 5. Session Reuse / Daemon Mode

#### Claude CLI Session Continuity

The Claude CLI supports session concepts but NOT a persistent daemon mode:

- `--session-id <uuid>`: Sets a specific session ID for the conversation
- `-c, --continue`: Continues the most recent conversation
- `-r, --resume [value]`: Resume a conversation by session ID
- `--fork-session`: Create a new session ID when resuming

However, each `--print` invocation still spawns a fresh Node.js process. There is no IPC/socket-based daemon mode where the CLI stays running in the background.

#### Potential Workaround: Custom Daemon

One could implement a lightweight HTTP server that:
1. Starts once and stays running as a background process
2. Accepts requests via HTTP/stdio
3. Uses `@anthropic-ai/sdk` to make direct API calls
4. Maintains an API client instance (no cold start per request)

This would effectively be building a thin proxy, which adds complexity but eliminates all process spawn overhead.

#### SDK Connection Reuse

When using `@anthropic-ai/sdk` directly in the extension host process:
- The HTTP client (using Node.js `fetch` or `undici`) maintains connection pooling automatically
- Keep-alive connections to the API endpoint are reused between calls
- No cold start after first initialization
- This is the most practical "persistent" approach

### 6. Similar Tools Benchmark

#### aicommits (Nutlope/aicommits)

- **SDK**: Uses Vercel AI SDK (`ai` package) with `@ai-sdk/openai-compatible`
- **API**: Direct HTTP calls to OpenAI-compatible APIs (not CLI subprocess)
- **Speed**: Claims 1-3 second generation time (depends on API provider)
- **Architecture**: No CLI spawning; direct SDK calls
- **Timeout**: 10s default (configurable)
- **Diff handling**: `--diff-algorithm=minimal`, lock file exclusion, token counting
- **Models**: Supports any OpenAI-compatible provider (OpenAI, Ollama, custom)
- **Key insight**: Fast because it makes direct API calls, not CLI invocations

#### opencommit (di-sukharev/opencommit)

- **SDK**: OpenAI SDK directly
- **API**: Direct HTTP calls to OpenAI API
- **Speed**: Claims "1 second" in description
- **Architecture**: No CLI spawning; direct SDK calls with token-aware chunking
- **Diff handling**: Binary/lock file exclusion, `.opencommitignore`, token counting via `tiktoken`
- **Models**: OpenAI models (gpt-4o-mini, gpt-4o, etc.)
- **Key insight**: Token-aware chunking ensures diffs never exceed context limits

#### commitizen

- **Note**: commitizen is a commit format tool, NOT an AI commit generator. It provides interactive prompts for conventional commits but does not generate messages from diffs. Not relevant for this comparison.

#### Key Takeaway from Similar Tools

ALL fast AI commit tools use direct API calls (SDK or HTTP), NOT CLI subprocess spawning. The CLI spawn overhead is the primary bottleneck.

### Files Found

| File Path | Description |
|---|---|
| `src/services/claude-cli.ts` | Current CLI invocation implementation (lines 152-249: `executeClaude`) |
| `src/commands/generate.ts` | Command handler that triggers generation |
| `src/services/git-service.ts` | Git diff retrieval (lines 47-72: `executeGitDiff`) |
| `src/extension.ts` | Extension entry point |
| `package.json` | Extension manifest, no Anthropic SDK dependency currently |

### Code Patterns

**Current invocation pattern** (`src/services/claude-cli.ts:152-249`):
- Writes prompt to temp file
- Spawns shell via `execFile('/bin/bash', ['-l', '-c', command])` (login shell for PATH)
- Pipes temp file content to claude stdin
- Uses `--print --output-format json --system-prompt ... --dangerously-skip-permissions`
- 120s timeout, 10MB max buffer
- Parses JSON response, falls back to plain text

**Missing flags in current implementation:**
- `--bare` (or `CLAUDE_CODE_SIMPLE=1` env): Would reduce ~6-13s of overhead
- `--model haiku`: Would reduce API response time
- `--effort low`: Would reduce model reasoning time
- `--no-session-persistence`: Would skip disk I/O for session saving

### External References

- [Claude CLI --help output](local) - Full flag reference, captured 2026-05-14, version 2.1.88
- [Anthropic Prompt Caching docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) - Automatic and explicit caching, minimum token thresholds
- [Anthropic TypeScript SDK](https://www.npmjs.com/package/@anthropic-ai/sdk) - v0.96.0, MIT license
- [aicommits source](https://github.com/Nutlope/aicommits) - Uses Vercel AI SDK, direct API calls
- [opencommit source](https://github.com/di-sukharev/opencommit) - Uses OpenAI SDK, token-aware chunking

## Caveats / Not Found

- **No `--max-tokens` CLI flag**: The Claude CLI does not expose the `max_tokens` API parameter. To control output length, you must use the API directly or rely on prompt instructions.
- **No daemon mode**: Claude CLI has no persistent background process mode. Each `--print` invocation is a fresh process.
- **Auth considerations**: Switching from CLI to direct SDK requires managing API keys separately. The user's current setup uses `ANTHROPIC_AUTH_TOKEN` env var via Claude settings, which could be read from `~/.claude/settings.json` or configured in extension settings.
- **BigModel proxy**: The user's setup routes through `open.bigmodel.cn/api/anthropic` which may have different latency characteristics than direct Anthropic API. Benchmark numbers reflect this proxy.
- **JSON response from CLI**: The CLI JSON output includes `cache_read_input_tokens` showing the CLI's internal prompt caching is working, but user-provided `--system-prompt` content is NOT cached between separate `--print` invocations.
- **Rate limits**: Using haiku model with direct API calls enables much higher throughput but could hit rate limits faster if the user generates many commit messages in succession.
