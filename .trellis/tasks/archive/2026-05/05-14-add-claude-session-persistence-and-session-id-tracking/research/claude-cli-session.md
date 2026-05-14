# Research: Claude CLI Session Management

- **Query**: Claude Code CLI session management -- session persistence, session-id, resume, continue, session listing, metadata
- **Scope**: mixed (CLI help output, local session files on disk, internal codebase references, live testing)
- **Date**: 2026-05-14

## Findings

### 1. `--no-session-persistence` and Default Behavior

**By default, the Claude CLI DOES save sessions to disk.** When `--no-session-persistence` is omitted, sessions are persisted as JSONL files.

Verified through live testing:
- With `--no-session-persistence`: no session file created on disk at `~/.claude/projects/<project>/<session-id>.jsonl`
- Without `--no-session-persistence` (default): session file IS created at `~/.claude/projects/<project>/<session-id>.jsonl`

The `--no-session-persistence` flag only works with `--print` mode. Interactive sessions always persist.

**Implication for the extension**: Removing `--no-session-persistence` means every `claude -p` invocation will write a JSONL session file to disk, enabling resume/review later. The trade-off is slight disk I/O overhead (estimated 0.1-0.3s per the optimization research).

### 2. `--session-id` Flag

```
--session-id <uuid>    Use a specific session ID for the conversation (must be a valid UUID)
```

- Accepts any valid UUID (lowercase or uppercase, verified through testing)
- When specified, the session is stored with that exact ID on disk
- The same session ID appears in the JSON output's `session_id` field
- This is critical for the extension: you can assign a deterministic session ID (e.g., based on repo path + timestamp) and later resume that exact session
- Verified: `claude -p --session-id "e34f21af-aa74-41ad-8c04-a65ac98af699" --output-format json` creates a file at `~/.claude/projects/<project>/e34f21af-aa74-41ad-8c04-a65ac98af699.jsonl`

### 3. Listing Past Sessions

There is **NO `claude sessions list` subcommand**. The `sessions` subcommand does not exist in the CLI.

Session discovery methods:

**Method A: Interactive picker** (`claude -r` or `claude --resume` without a session ID)
- Without `--print`: opens an interactive picker showing recent sessions with display names, timestamps, and working directory
- With `--print`: requires a session ID argument; no interactive picker available

**Method B: Read the filesystem directly**
- Session JSONL files are stored at: `~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl`
- The encoded project path transforms `/` to `-` (e.g., `/Users/bingo/Github/bingohuang/vscode-ai-commit` becomes `-Users-bingo-Github-bingohuang-vscode-ai-commit`)
- Session metadata (PID, session ID, CWD, start time, version, entrypoint) is stored in: `~/.claude/sessions/<pid>.json`
- Files are sorted by modification time (most recent first)

**Method C: `/resume` slash command** (interactive mode only)
- Inside an interactive session, `/resume` opens a picker of past sessions

**Related flag**: `-n, --name <name>` lets you set a display name for a session, visible in the `/resume` picker and terminal title.

### 4. Resuming / Viewing a Specific Session

```
-r, --resume [value]    Resume a conversation by session ID, or open interactive picker with optional search term
-c, --continue          Continue the most recent conversation in the current directory
```

**`--resume <session-id>`**:
- With `--print`: `claude -p --resume <session-id> --output-format json "follow-up prompt"` -- resumes the session and sends a new prompt, returns JSON result
- Without `--print`: opens the session interactively in the terminal
- The session ID must be a valid UUID of an existing persisted session
- Verified working: `claude -p --resume e34f21af-aa74-41ad-8c04-a65ac98af699 --output-format json --model haiku "what did I just say?"` successfully resumed the session and the model had context of the prior exchange

**`--continue` (or `-c`)**:
- Resumes the most recent conversation in the current working directory
- No need to know the session ID -- picks the latest automatically
- With `--print`: `claude -p -c --output-format json "follow-up"`
- Without `--print`: opens the latest session interactively

**`--from-pr [value]`**:
- Resume a session linked to a PR by PR number/URL
- Opens interactive picker if no value given, or with optional search term

**`--fork-session`**:
- When used with `--resume` or `--continue`, creates a NEW session ID instead of reusing the original
- This means the original session remains unmodified and a branched conversation starts fresh

### 5. Metadata Available in Session History

#### From JSON output (`--output-format json`)

Every `claude -p --output-format json` call returns:

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 4500,
  "duration_api_ms": 4456,
  "num_turns": 1,
  "stop_reason": "end_turn",
  "session_id": "037a5312-76a5-440a-a32e-e67202761fa6",
  "total_cost_usd": 0.03353,
  "usage": {
    "input_tokens": 32475,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "output_tokens": 211,
    "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 0,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "",
    "iterations": [],
    "speed": "standard"
  },
  "modelUsage": {
    "claude-haiku-4-5-20251001": {
      "inputTokens": 32475,
      "outputTokens": 211,
      "cacheReadInputTokens": 0,
      "cacheCreationInputTokens": 0,
      "webSearchRequests": 0,
      "costUSD": 0.03353,
      "contextWindow": 200000,
      "maxOutputTokens": 32000
    }
  },
  "permission_denials": [],
  "fast_mode_state": "off",
  "uuid": "b2332f3e-1cfc-46c1-9e03-15e8d34ddef1"
}
```

Key metadata fields:
| Field | Description |
|---|---|
| `session_id` | UUID of the session (for resume) |
| `total_cost_usd` | Total cost in USD |
| `duration_ms` | Total wall-clock time |
| `duration_api_ms` | API call time |
| `num_turns` | Number of conversation turns |
| `usage.input_tokens` | Input token count |
| `usage.output_tokens` | Output token count |
| `usage.cache_read_input_tokens` | Cache hit tokens |
| `usage.cache_creation_input_tokens` | Cache miss tokens |
| `modelUsage` | Per-model breakdown with cost, context window, max output |
| `stop_reason` | "end_turn", etc. |
| `is_error` / `subtype` | Error detection |
| `uuid` | Unique result identifier |

#### From session files on disk

**Session JSONL** (`~/.claude/projects/<project>/<session-id>.jsonl`):
- Contains the full conversation transcript (user messages, assistant messages, tool use, file history snapshots)
- Entry types observed: `queue-operation`, `user`, `assistant`, `file-history-snapshot`, `last-prompt`
- Each entry has `sessionId`, `timestamp`, `version`, `cwd`, `gitBranch`
- Assistant entries include model name, token usage, stop reason
- No aggregate cost/summary entry at the end of the JSONL

**Session metadata** (`~/.claude/sessions/<pid>.json`):
```json
{
  "pid": 91112,
  "sessionId": "272d38b2-9041-4ee8-9873-477718b558b6",
  "cwd": "/Users/bingo/Github/bingohuang/deepseek-v4-deep-insight",
  "startedAt": 1778746383077,
  "procStart": "Thu May 14 08:13:02 2026",
  "version": "2.1.141",
  "peerProtocol": 1,
  "kind": "interactive",
  "entrypoint": "claude-vscode"
}
```

Fields:
| Field | Description |
|---|---|
| `pid` | Process ID (used as filename) |
| `sessionId` | Session UUID |
| `cwd` | Working directory |
| `startedAt` | Unix timestamp (ms) |
| `procStart` | Human-readable start time |
| `version` | Claude Code version |
| `kind` | "interactive" or "print" (likely) |
| `entrypoint` | "claude-vscode", "sdk-cli", etc. |

#### From environment variables

- `CLAUDE_SESSION_ID` -- Set during an active session (e.g., `03cd4775-2556-4e19-a5cb-a6146372d1c7`)
- `CLAUDE_CODE_SESSION_ID` -- Alternative env var (not set in current session but defined in trellis scripts)

### 6. `--continue` Flag

```
-c, --continue    Continue the most recent conversation in the current directory
```

- Yes, `--continue` (short: `-c`) exists and resumes the last session in the current directory
- Works with `--print`: `claude -p -c --output-format json "follow-up prompt"`
- Works without `--print`: opens the last session interactively
- No session ID needed -- it auto-discovers the most recent session for the current working directory
- Difference from `--resume`: `--continue` picks the latest session automatically; `--resume` requires specifying which session

### Session Storage Architecture

```
~/.claude/
  sessions/              # Active session metadata (by PID)
    <pid>.json           # Lightweight: sessionId, cwd, startedAt, version, kind, entrypoint
  projects/              # Session transcripts (by project path)
    -<encoded-path>/     # e.g., -Users-bingo-Github-bingohuang-vscode-ai-commit
      <session-uuid>.jsonl    # Full conversation transcript
      <session-uuid>/         # Session subdirectory (memory, worktrees, etc.)
        memory/               # Session memory files
```

### Current Extension Usage

The extension currently uses `--no-session-persistence` in `src/services/claude-cli.ts:177`:

```typescript
const args: string[] = [
    '--print',
    '--bare',
    '--output-format', 'json',
    '--model', model,
    '--effort', 'low',
    '--system-prompt', systemPrompt,
    '--dangerously-skip-permissions',
    '--no-session-persistence',
];
```

To add session persistence, replace `--no-session-persistence` with `--session-id <uuid>` where the UUID is generated by the extension (e.g., `crypto.randomUUID()`).

Note: `--bare` mode skips keychain reads and OAuth, so auth must come from `ANTHROPIC_API_KEY` or `apiKeyHelper`. If the extension needs subscription auth, `--bare` must be removed too.

### Complete Session-Related CLI Flags Summary

| Flag | Short | Purpose | Works with --print |
|---|---|---|---|
| `--session-id <uuid>` | - | Set a specific session ID | Yes |
| `--no-session-persistence` | - | Skip saving session to disk | Yes (only with --print) |
| `-c, --continue` | `-c` | Resume most recent session in cwd | Yes |
| `-r, --resume [value]` | `-r` | Resume specific session by ID | Yes (requires ID with --print) |
| `--fork-session` | - | Branch into new session ID when resuming | Yes |
| `--from-pr [value]` | - | Resume session linked to a PR | Yes |
| `-n, --name <name>` | `-n` | Set display name for session | Yes |

### Files Found

| File Path | Description |
|---|---|
| `src/services/claude-cli.ts:168-177` | Current `--no-session-persistence` usage in executeClaude() |
| `.trellis/tasks/archive/2026-05/05-14-ai-commit-mvp/research/claude-cli-usage.md` | Prior research on CLI flags including session flags |
| `.trellis/tasks/archive/2026-05/05-14-ai-commit-5/research/optimization-approaches.md:260-268` | Session continuity discussion |
| `.trellis/scripts/common/cli_adapter.py:317-434` | Trellis adapter for building session commands (--session-id, --resume) |
| `.trellis/scripts/common/active_task.py:49` | Session ID env var detection (CLAUDE_SESSION_ID, CLAUDE_CODE_SESSION_ID) |
| `~/.claude/sessions/` | Session metadata directory (by PID) |
| `~/.claude/projects/-Users-bingo-Github-bingohuang-vscode-ai-commit/` | Session transcripts for this project |

## Caveats / Not Found

1. **No `claude sessions list` command**: There is no CLI subcommand to list sessions programmatically. The only way to list sessions is via the interactive picker (`claude -r` without `--print`) or by reading the filesystem directly.

2. **Session metadata is minimal**: The `~/.claude/sessions/<pid>.json` files only contain PID, session ID, CWD, start time, version, kind, and entrypoint. There is NO cost, token count, or duration metadata in these files. That information is only available in the JSON output of `claude -p --output-format json` at invocation time, or by parsing the JSONL transcript.

3. **No aggregate summary in JSONL**: The session JSONL files contain per-message data but no aggregate cost/usage summary at the end. To get total cost/tokens for a session, you would need to parse the entire JSONL or rely on the JSON output captured at invocation time.

4. **`--bare` + session persistence**: When using `--bare` mode, session persistence still works (sessions are saved to disk). But `--bare` forces API key auth and skips OAuth. The extension must choose between `--bare` (faster, no subscription auth) and non-bare (subscription auth, slower startup).

5. **`--continue` scope**: `--continue` only finds sessions in the current working directory. If the extension changes `cwd` between invocations, `--continue` may not find the expected session.

6. **Session file cleanup**: No information found on automatic session file cleanup or retention policy. Sessions appear to accumulate indefinitely.

7. **CLI version**: Testing was performed with `claude` version 2.1.88 (local) and 2.1.141 (referenced in session files). Session behavior may differ across versions.
