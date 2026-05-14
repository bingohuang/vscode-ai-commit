# Research: VS Code Git SCM API Integration for AI Commit Extension

- **Query**: How VS Code extensions integrate with the built-in Git SCM API to add custom actions (like a "generate commit message" button) in the Git panel
- **Scope**: mixed (internal + external)
- **Date**: 2026-05-14

## Findings

### 1. Accessing the VS Code Git Extension API

The built-in Git extension (`vscode.git`) exposes an API that other extensions can access. The canonical pattern:

```typescript
import { GitExtension, API, Repository } from './typings/git'; // Copy git.d.ts from VS Code source

const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')!.exports;
const api: API = gitExtension.getAPI(1); // Version 1 is the current stable API
const repositories: Repository[] = api.repositories;
```

**Key API surface** (from `extensions/git/src/api/git.d.ts`):

| Interface / Method | Purpose |
|---|---|
| `GitExtension.getAPI(1)` | Get version 1 of the Git API. Throws if Git extension is disabled. |
| `API.repositories` | Array of open `Repository` objects |
| `API.getRepository(uri)` | Get the Repository for a given URI |
| `Repository.rootUri` | Root URI of the repository |
| `Repository.inputBox` | `InputBox` with `.value` property (read/write the commit message text) |
| `Repository.state` | `RepositoryState` with `indexChanges`, `workingTreeChanges`, `untrackedChanges`, `HEAD`, `onDidChange` |
| `Repository.diff(cached?: boolean)` | Get diff. `cached=true` returns staged diff, `cached=false` or no arg returns working tree diff. Returns `Promise<string>`. |
| `Repository.diffWithHEAD()` | Get diff with HEAD. Returns `Change[]` or `string` (overloaded). |
| `Repository.log(options?)` | Get commit log. `LogOptions.maxEntries` controls count. |
| `Repository.status()` | Refresh repository status |

**Getting the staged diff** (the critical piece for this extension):

```typescript
const stagedDiff: string = await repository.diff(true);  // cached=true means staged
```

**Important**: The Git extension API is **not a proposed API** -- it is a stable, published API that extensions can use. However, you must copy the `git.d.ts` type definition file into your project since it is not published as an npm package. The file is located at `extensions/git/src/api/git.d.ts` in the VS Code repository.

**Extension activation**: The Git extension may not be active when your extension activates. You must handle this:

```typescript
const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
if (!gitExtension) {
  // Git extension not installed (very rare, it's built-in)
  return;
}
if (!gitExtension.isActive) {
  await gitExtension.activate();
}
const api = gitExtension.exports.getAPI(1);
```

### Files Found

| File Path | Description |
|---|---|
| `src/extension.ts` | Current scaffolded extension (only helloWorld command) |
| `package.json` | Current package manifest (only `vscode-ai-commit.helloWorld` command) |

### 2. Adding a Custom Button to the Git SCM Panel

There are **two approaches** with different trade-offs:

#### Approach A: `scm/title` menu (Stable API, recommended)

This adds an icon button to the **title bar** of the Source Control panel (top-right area, next to the built-in refresh/commit buttons).

**package.json contribution:**
```json
{
  "contributes": {
    "commands": [
      {
        "command": "vscode-ai-commit.generate",
        "title": "Generate Commit Message",
        "icon": "$(sparkle)"
      }
    ],
    "menus": {
      "scm/title": [
        {
          "command": "vscode-ai-commit.generate",
          "group": "navigation",
          "when": "scmProvider == git"
        }
      ]
    }
  }
}
```

- `"group": "navigation"` places the button in the title bar as an icon
- `"when": "scmProvider == git"` ensures it only shows for Git (not other SCM providers)
- `"icon": "$(sparkle)"` uses a built-in VS Code codicon (same icon as GitHub Copilot uses)
- The command handler receives an optional `sourceControl?: vscode.SourceControl` parameter when triggered from the SCM title menu

**This is the approach used by**:
- `uaoa/claude-commit-vscode` -- uses `scm/title` with `$(sparkle)` icon
- `spraylee/vscode-ai-commit` -- uses `scm/title` with `$(lightbulb)` icon
- `tomblind/scm-buttons-vscode` -- adds additional SCM buttons

#### Approach B: `scm/inputBox` menu (Proposed API -- requires special handling)

This adds a button **inside the commit message input box** (the sparkle icon that Copilot uses). This is the more natural UX placement but requires the **proposed API** `contribSourceControlInputBoxMenu`.

**package.json contribution:**
```json
{
  "enabledApiProposals": ["contribSourceControlInputBoxMenu"],
  "contributes": {
    "commands": [
      {
        "command": "vscode-ai-commit.generate",
        "title": "Generate Commit Message",
        "icon": "$(sparkle)"
      }
    ],
    "menus": {
      "scm/inputBox": [
        {
          "command": "vscode-ai-commit.generate",
          "when": "scmProvider == git"
        }
      ]
    }
  }
}
```

**Using a proposed API requires**:
1. Adding `"enabledApiProposals": ["contribSourceControlInputBoxMenu"]` to package.json
2. Getting approval from the VS Code team, OR using a development/sideloaded extension (not from the marketplace)
3. The proposed API definition file is at `src/vscode-dts/vscode.proposed.contribSourceControlInputBoxMenu.d.ts` (currently just an empty placeholder)

**This is the approach used by**:
- `doggy8088/vscode-codegpt` -- uses `enabledApiProposals: ["contribSourceControlInputBoxMenu"]` and `"menus": {"scm/inputBox": [...]}`

**Recommendation**: Start with Approach A (`scm/title`) for marketplace compatibility. The `scm/inputBox` approach is more polished UX but requires proposed API approval.

### 3. How Similar Extensions Implement This Pattern

#### uaoa/claude-commit-vscode

- **GitHub**: https://github.com/uaoa/claude-commit-vscode
- **Button placement**: `scm/title` with `$(sparkle)` icon, `group: navigation`, `when: scmProvider == git`
- **Git API access**: `vscode.extensions.getExtension("vscode.git")` -> `exports.getAPI(1)` -> `repositories` -> `repo.state.indexChanges` / `repo.state.workingTreeChanges`
- **Diff retrieval**: Uses `child_process.exec` to run `git diff --cached --unified=1` and `git diff --cached --stat` directly (NOT the VS Code Git API `diff()` method). Also has an "auto" mode that falls back to `git diff HEAD` if no staged changes.
- **CLI execution**: Uses `child_process.exec` (promisified) to call Claude CLI: `cat promptFile | claude -p --no-session-persistence --model haiku --tools "" --effort low`
- **Writing commit message**: `repo.inputBox.value = commitMessage`
- **Multi-repo support**: Resolves repo from `sourceControl` parameter (passed by SCM menu), falls back to active editor, then first repo
- **CLI detection**: Checks `which claude`, shell profile sourcing, common paths like `/usr/local/bin/claude`, `~/.claude/local/claude`, homebrew paths, etc. Caches result.
- **Key detail**: Uses `/bin/bash -l -c` to execute the CLI command, which loads the user's shell environment (important for PATH and env vars)

#### spraylee/vscode-ai-commit

- **GitHub**: https://github.com/spraylee/vscode-ai-commit
- **Button placement**: `scm/title` with `$(lightbulb)` icon, `group: navigation`, `when: scmProvider == git`
- **Keybinding**: Also registers `F4` as a keyboard shortcut
- **Git API access**: Full type definitions for `GitExtension`, `Git`, `Repository`, `RepositoryState`, `Change`, `Status` enum
- **Diff retrieval**: Uses the VS Code Git API's `repository.diff(true)` for staged and `repository.diff(false)` for working tree. Also manually generates diff for untracked files by reading their content and formatting as unified diff.
- **AI provider**: Calls OpenAI/Claude/Azure APIs via HTTP (not CLI). No CLI path detection.
- **Writing commit message**: `repository.inputBox.value = commitMessage`
- **Diff filtering**: Has an ignore list for lock files, binary files, minified files, etc.

#### Sitoi/ai-commit

- **GitHub**: https://github.com/Sitoi/ai-commit
- **Button placement**: Command palette only (no SCM panel button)
- **Activation**: `onCommand:ai-commit`
- **AI provider**: OpenAI/Azure/DeepSeek/Gemini API calls

#### doggy8088/vscode-codegpt

- **GitHub**: https://github.com/doggy8088/vscode-codegpt
- **Button placement**: `scm/inputBox` (proposed API) -- sparkle icon appears INSIDE the commit input box
- **Uses**: `enabledApiProposals: ["contribSourceControlInputBoxMenu"]`
- **Note**: This extension cannot be published to the VS Code marketplace with proposed APIs without special approval

### 4. Spawning a Child Process to Call an External CLI Tool

VS Code extensions run in a Node.js environment and can use Node's `child_process` module directly.

**Pattern from claude-commit-vscode** (most relevant, since it calls the `claude` CLI):

```typescript
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Write prompt to temp file (avoids shell escaping issues with large prompts)
const promptFile = path.join(os.tmpdir(), `claude-commit-prompt-${Date.now()}.txt`);
await fs.promises.writeFile(promptFile, prompt, { encoding: "utf-8" });

// Build the command
const cliPath = "/path/to/claude";
const escapedCliPath = cliPath.includes(" ") ? `"${cliPath}"` : cliPath;
const cliFlags = `-p --no-session-persistence --model haiku --tools "" --effort low`;
const baseCommand = `cat "${promptFile}" | ${escapedCliPath} ${cliFlags}`;

// Use login shell to load user's environment variables
const command = process.platform === "win32"
  ? baseCommand
  : `/bin/bash -l -c ${JSON.stringify(baseCommand)}`;

// Execute with timeout and buffer limits
const { stdout, stderr } = await execAsync(command, {
  maxBuffer: 10 * 1024 * 1024,  // 10MB buffer for large diffs
  timeout: 120000,               // 2 minute timeout
});

// Clean up temp file
await fs.promises.unlink(promptFile);
```

**Key considerations for CLI execution**:

| Issue | Solution |
|---|---|
| Large prompt text | Write to temp file, pipe via `cat` |
| Shell environment (PATH) | Use `/bin/bash -l -c` on macOS/Linux to source user's `.zshrc`/`.bashrc` |
| Windows compatibility | Use `type` instead of `cat`, `cmd.exe` shell |
| Process timeout | Set `timeout: 120000` (2 min) in exec options |
| Buffer overflow | Set `maxBuffer: 10 * 1024 * 1024` |
| Temp file cleanup | Use `finally` block to unlink prompt file |
| Privacy mode | Set file mode `0o600` on temp files when privacy is enabled |
| CLI not found | Multi-strategy detection: user config > `which claude` > shell profile > common paths |

**Alternative: Using `spawn` for streaming output**:

```typescript
import { spawn } from 'child_process';

const child = spawn('claude', ['-p', '--model', 'haiku'], {
  cwd: repoPath,
  env: { ...process.env },
  shell: true,
});

child.stdin.write(prompt);
child.stdin.end();

let stdout = '';
let stderr = '';
child.stdout.on('data', (data) => { stdout += data; });
child.stderr.on('data', (data) => { stderr += data; });
```

### 5. Limitations and Gotchas with the VS Code Git API

| Gotcha | Details |
|---|---|
| **API version is locked at 1** | `getAPI(1)` is the only version. The API is stable but not versioned independently from VS Code. Breaking changes between VS Code versions are possible but rare. |
| **Git extension must be enabled** | `getAPI()` throws if the Git extension is disabled. Listen to `GitExtension.onDidChangeEnablement` to handle enable/disable. |
| **Git extension may not be active** | Must call `await gitExtension.activate()` before accessing exports. |
| **No npm package for types** | You must copy `git.d.ts` from `extensions/git/src/api/git.d.ts` in the VS Code repo into your project. |
| **`repository.diff()` vs `git diff` CLI** | The VS Code Git API's `repository.diff(cached)` may differ slightly from raw `git diff --staged`. The spraylee extension found that the API method works but the claude-commit extension chose to use raw `git diff --cached` for more control. |
| **`scm/inputBox` is proposed API** | The `contribSourceControlInputBoxMenu` proposed API allows placing buttons inside the commit input box (like Copilot's sparkle), but it requires proposed API approval and cannot be published to the marketplace without it. |
| **Multiple repositories** | `api.repositories` may contain multiple repos. Must handle multi-root workspaces. The `sourceControl` parameter passed to SCM menu commands can help identify the correct repo. |
| **`inputBox.value` write is the standard way** | To set the commit message, write to `repo.inputBox.value = message`. There is no other public API to pre-fill the SCM input box. |
| **`repository.state.indexChanges`** | This is an array of `Change` objects (with `uri` and `status`). Use it to check if there are staged changes before generating. The `Status` enum values: `INDEX_MODIFIED=0`, `INDEX_ADDED=1`, `INDEX_DELETED=2`, `INDEX_RENAMED=3`, `INDEX_COPIED=4`. |
| **Untracked files diff** | `repository.diff()` does not include untracked files. You must manually read file content and construct a diff, or use `git diff` CLI. |
| **`repository.status()` must be called** | Call `await repository.status()` to refresh state before reading `state.indexChanges` to ensure freshness. |
| **Temp file security** | When writing prompt files to `/tmp`, use `0o600` mode for privacy. Clean up files in `finally` blocks. |
| **CLI path resolution** | The `claude` CLI may be installed via npm globally, homebrew, or direct download. Path varies by platform and install method. Must implement robust detection (see claude-commit-vscode's detection.ts). |
| **Shell environment** | VS Code extensions don't inherit the user's full shell environment. Use `/bin/bash -l -c` to source profile files, or the `claude` CLI may not be found even if installed. |

### External References

- [VS Code Source Control API Guide](https://code.visualstudio.com/api/extension-guides/scm-provider) -- Official docs on SCM provider API
- [VS Code Contribution Points Reference](https://code.visualstudio.com/api/references/contribution-points) -- All `contributes` points including `menus`
- [VS Code git.d.ts type definitions](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts) -- Official type definitions for the Git extension API
- [scm/inputBox proposed API issue #195474](https://github.com/microsoft/vscode/issues/195474) -- Proposal for `scm/inputBox` menu contribution point
- [StackOverflow: Access the git API in VS Code](https://stackoverflow.com/questions/46511595/how-to-access-the-api-for-git-in-visual-studio-code) -- Community patterns
- [StackOverflow: Custom button in Git SCM input field](https://stackoverflow.com/questions/77594965/how-do-i-create-a-custom-button-in-the-git-message-field-of-the-vs-code-source-c) -- Details on `scm/inputBox` proposed API
- [StackOverflow: Custom button in Source Control tab](https://stackoverflow.com/questions/75893497/how-do-i-create-a-custom-button-in-vscode-source-control-tab) -- `scm/title` menu pattern
- [uaoa/claude-commit-vscode](https://github.com/uaoa/claude-commit-vscode) -- Full reference implementation using Claude CLI, `scm/title` button
- [spraylee/vscode-ai-commit](https://github.com/spraylee/vscode-ai-commit) -- Reference implementation using VS Code Git API `diff()`, multi-provider
- [doggy8088/vscode-codegpt](https://github.com/doggy8088/vscode-codegpt) -- Reference for `scm/inputBox` proposed API usage
- [Sitoi/ai-commit](https://github.com/Sitoi/ai-commit) -- Popular AI commit extension (API-based, no CLI)

### Related Specs

- `.trellis/spec/frontend/index.md` -- Frontend spec index

## Caveats / Not Found

- The `contribSourceControlInputBoxMenu` proposed API has no published documentation beyond the GitHub issue and the empty placeholder `.d.ts` file. The exact capabilities and limitations are not well documented.
- The `git.d.ts` file may change between VS Code versions. There is no guarantee of backward compatibility, though version 1 has been stable for years.
- No information found on whether the `claude` CLI's `-p` (pipe mode) flag has any undocumented behavior or edge cases.
- The `scm/inputBox` approach (proposed API) requires either sideloading the extension or getting explicit VS Code team approval -- the process for this approval is not well documented.
