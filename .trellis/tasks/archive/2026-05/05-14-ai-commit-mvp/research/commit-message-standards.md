# Research: Commit Message Standards and AI Generation Patterns

- **Query**: Conventional commit message formats, AI commit generator output patterns, prompt engineering for diff-to-commit, multi-scope handling, body best practices, configurable conventions
- **Scope**: External (specifications, open-source tooling) + Internal (project context)
- **Date**: 2026-05-14

## Findings

### 1. Conventional Commits Specification (v1.0.0)

**Source**: [conventionalcommits.org](https://www.conventionalcommits.org/en/v1.0.0/)

#### Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

#### Canonical Types (from @commitlint/config-conventional, based on Angular convention)

| Type | Description | SemVer Impact |
|------|-------------|---------------|
| `feat` | A new feature | MINOR |
| `fix` | A bug fix | PATCH |
| `docs` | Documentation only changes | None |
| `style` | Changes that do not affect meaning (whitespace, formatting, missing semi-colons) | None |
| `refactor` | Code change that improves structure without changing functionality | None |
| `perf` | Code change that improves performance | None |
| `test` | Adding missing tests or correcting existing tests | None |
| `build` | Changes that affect build system or external dependencies | None |
| `ci` | Changes to CI configuration files and scripts | None |
| `chore` | Other changes that don't modify src or test files | None |
| `revert` | Reverts a previous commit | None |

#### Key Rules from the Spec

1. `fix` type maps to PATCH in SemVer; `feat` maps to MINOR
2. `BREAKING CHANGE:` in the body or footer, or a `!` after the type/scope, maps to MAJOR
3. Types other than `feat` and `fix` are allowed (the spec intentionally leaves them open)
4. Scope is optional and typically denotes the module/package affected
5. Description must be in imperative mood ("add feature" not "added feature")
6. Subject line should be max 50-72 characters
7. Body lines should wrap at 72 characters

#### Type Priority (when a commit mixes types)

From the Open edX proposal (OEP-51): "If a commit mixes types, use the most important type label." Priority order: `feat > fix > perf > revert > docs > test > build > ci > refactor > chore > style`.

---

### 2. How Popular AI Commit Tools Format Their Output

#### aicommits (Nutlope/aicommits)

**Source**: [github.com/Nutlope/aicommits](https://github.com/Nutlope/aicommits)

- Supports 3 commit types via `type` config: `plain`, `conventional`, `gitmoji`
- Default type is `plain` (just a message, no prefix)
- `conventional` format: `<type>[optional (<scope>)]: <commit message>` with lowercase type requirement
- `gitmoji` format: `:emoji: <commit message>`
- Generates only the **subject line** (title), no body by default
- Max length configurable, default 72 characters
- Provides type-to-description JSON in the prompt for type selection
- Supports `--prompt` flag for custom instructions (e.g., language, style)
- Config: `aicommits config set type=conventional`

**aicommits prompt template** (from `src/utils/prompt.ts`):
```
Generate a concise git commit message title in present tense that precisely
describes the key changes in the following code diff. Focus on what was changed,
not just file names. Provide only the title, no description or body.
Message language: {locale}
Commit message must be a maximum of {maxLength} characters.
Exclude anything unnecessary such as translation. Your entire response will be
passed directly into git commit.
IMPORTANT: Do not include any explanations, introductions, or additional text.
Do not wrap the commit message in quotes or any other formatting.
Be specific: include concrete details (package names, versions, functionality)
rather than generic statements.
[custom prompt if provided]
[type-to-description JSON]
The output response must be in format:
{format}
```

**aicommits conventional type definitions** (exact JSON from source):
```json
{
  "docs": "Documentation only changes",
  "style": "Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)",
  "refactor": "A code change that improves code structure without changing functionality (renaming, restructuring classes/methods, extracting functions, etc)",
  "perf": "A code change that improves performance",
  "test": "Adding missing tests or correcting existing tests",
  "build": "Changes that affect the build system or external dependencies",
  "ci": "Changes to our CI configuration files and scripts",
  "chore": "Other changes that don't modify src or test files",
  "revert": "Reverts a previous commit",
  "feat": "A new feature",
  "fix": "A bug fix"
}
```

#### OpenCommit (di-sukharev/opencommit)

**Source**: [github.com/di-sukharev/opencommit](https://github.com/di-sukharev/opencommit)

- Most feature-rich AI commit CLI (7.1k+ stars)
- Default prompt module: `conventional-commit`
- Alternative prompt module: `@commitlint` (uses project's commitlint config for consistency)
- Generates **full commit with body and scope** (unlike aicommits which is title-only)
- Supports GitMoji mode (`OCO_EMOJI=true`)
- Supports full GitMoji specification mode (`fullGitMojiSpec`)
- Supports `OCO_DESCRIPTION=true` to add body explaining WHY
- Supports `OCO_ONE_LINE_COMMIT=true` for single-line output
- Supports `OCO_OMIT_SCOPE=true` to skip scope
- Supports `OCO_MESSAGE_TEMPLATE_PLACEHOLDER` for custom message templates
- 18 language translations (i18n)
- `commitlint` integration: reads project's commitlint config and generates consistency prompts

**OpenCommit system prompt structure** (from `src/prompts.ts`):
```
You are to act as an author of a commit message in git. Your mission is to
create clean and comprehensive commit messages as per the {convention} and
explain WHAT were the changes and mainly WHY the changes were done.

I'll send you an output of 'git diff --staged' command, and you are to convert
it into a commit message.

[convention guidelines - GitMoji or Conventional Commit keywords]
[description guideline - whether to include body]
[one-line commit guideline if enabled]
[scope instruction if omit-scope]
Use the present tense. Lines must not be longer than 74 characters.
Use {language} for the commit message.
[additional user context if provided]
```

**OpenCommit consistency prompt** (few-shot examples from `i18n/en.json`):
```
fix(server.ts): change port variable case from lowercase port to uppercase PORT to improve semantics
feat(server.ts): add support for process.env.PORT environment variable to be able to run app on a configurable port
The port variable is now named PORT, which improves consistency with the naming conventions as PORT is a constant. Support for an environment variable allows the application to be more flexible as it can now run on any available port specified via the process.env.PORT environment variable.
```

**OpenCommit conventional commit keywords instruction**:
```
Do not preface the commit with anything, except for the conventional commit
keywords: fix, feat, build, chore, ci, docs, style, refactor, perf, test.
```

**OpenCommit emoji mapping** (when OCO_EMOJI=true):
```typescript
const COMMIT_TYPES = { fix: '🐛', feat: '✨' } as const;
// Output: "🐛 fix(server): ..." or "✨ feat(api): ..."
```

#### ai-commit (Sitoi/VS Code Extension)

**Source**: [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Sitoi.ai-commit)

- Existing VS Code extension for AI commit generation
- Supports OpenAI/Gemini/Claude/Azure API
- Generates conventional commit messages
- Reviews Git changes before generating

#### ai-commit (insulineru)

**Source**: [github.com/insulineru/ai-commit](https://github.com/insulineru/ai-commit)

- Combines ChatGPT with Gitmoji and Conventional Commits
- Plans for: interactive commit message generation, customizable templates, advanced diff analysis

#### ai-commit (chophe)

**Source**: [github.com/chophe/ai-commit](https://github.com/chophe/ai-commit)

- Supports Conventional Commits format
- Supports Gitmoji integration
- Configurable commit message language and length
- Custom OpenAI base URL support

#### ai-commit (renatogalera)

**Source**: [github.com/renatogalera/ai-commit](https://github.com/renatogalera/ai-commit)

- Ticket auto-detection from branch names (JIRA, GitHub, Linear) via `{TICKET_ID}` template placeholder
- Git hook integration (`ai-commit hook install`)
- Scope auto-detection
- Commit message style review (`--review-message`)

#### Visual Studio Copilot (Microsoft)

**Source**: [devblogs.microsoft.com](https://devblogs.microsoft.com/visualstudio/customize-your-ai-generated-git-commit-messages/)

- Navigate to Tools > Options > Copilot to customize
- Supports "Follow Conventional Commits standard" and "Use gitmoji" options
- User can input desired parameters for commit style

#### theorib/git-commit-message-ai-prompt

**Source**: [github.com/theorib/git-commit-message-ai-prompt](https://github.com/theorib/git-commit-message-ai-prompt)

- Purpose-built prompt for generating thorough, consistent, precise commit messages per Conventional Commits 1.0.0
- Designed to work with the AI Commit VS Code plugin
- Gives AI precise instructions on composing a commit message based on git diff

---

### 3. Prompt Engineering Patterns for AI Commit Generation

#### Pattern A: Title-Only Generation (aicommits approach)

- System prompt instructs: "Provide only the title, no description or body"
- Response is passed directly to `git commit -m`
- Simpler, faster, lower token cost
- Good for small/medium changes
- Weakness: loses WHY context for complex changes

#### Pattern B: Full Commit with Body (OpenCommit approach)

- System prompt: "explain WHAT were the changes and mainly WHY the changes were done"
- Generates subject + body (separated by blank line)
- Uses few-shot examples (consistency prompt) to format correctly
- Better for meaningful history, but more tokens and may hallucinate reasoning

#### Pattern C: Few-Shot with Consistency (OpenCommit @commitlint module)

- Reads project's commitlint config
- Generates few-shot examples matching project's conventions
- LLM sees: system prompt + example diff + example output (in project's style)
- Most consistent with team standards, but requires commitlint setup

#### Pattern D: Chunked Diff Processing (aicommits for large diffs)

- When >50 staged files, splits into chunks of 10
- Generates separate messages per chunk, then combines
- Handles token limits but may produce fragmented messages

#### Key Prompt Design Principles (from research)

1. **Specify format explicitly**: "The output response must be in format: `<type>[optional (<scope>)]: <commit message>`"
2. **Provide type definitions as JSON**: LLM selects type by matching diff semantics to description
3. **Enforce lowercase types**: "IMPORTANT: The type MUST be lowercase (e.g., 'feat', not 'Feat')"
4. **Enforce present tense**: "Use the present tense"
5. **Set character limits**: "Lines must not be longer than 74 characters" (OpenCommit) or max 72 (aicommits)
6. **Be specific about exclusions**: "Exclude anything unnecessary such as translation. Do not include any explanations"
7. **Include few-shot examples**: OpenCommit's consistency prompt (example diff -> example commit) dramatically improves format adherence
8. **Allow user context**: `--prompt` flag or `--` separator for additional context
9. **Language control**: Explicit `Message language: {locale}` instruction
10. **Chain-of-thought for reasoning models**: aicommits handles `<think>...</think>` tags from DeepSeek R1 / QwQ

#### Optimal Prompt Structure (synthesized from tools)

```
[Identity]: You are the author of a commit message in git.
[Mission]: Create clean, comprehensive commit messages per {convention}.
[Input]: I'll send you 'git diff --staged' output.
[Convention]: {type definitions or gitmoji spec}
[Format]: Output must follow: {format template}
[Constraints]: Present tense, max {N} chars, {language}, no extra text.
[Scope rule]: {include/omit scope based on config}
[Body rule]: {include body with WHY / title-only}
[Few-shot examples]: {1-2 example diffs with correct output}
[User context]: {optional additional context}
```

---

### 4. Multi-Scope Changes

#### How AI tools handle it

- **aicommits**: Does not explicitly handle multi-scope. Generates a single type/scope. If scope is ambiguous, it tends to omit scope (fall back to no scope).
- **OpenCommit**: Supports `OCO_OMIT_SCOPE=true` to always omit scope. When scope is enabled, the LLM picks the most relevant scope from the diff. No explicit multi-scope support.
- **No tool supports multiple scopes in one commit** (e.g., `feat(frontend,backend):` is not a pattern any tool generates).

#### Best practice recommendations from community

1. **Pick the primary intent**: "If a commit mixes types, use the most important type label" (OEP-51)
2. **Use the broadest scope**: If changes touch both `frontend` and `backend`, use a higher-level scope like `api`, `app`, or omit scope
3. **Suggest splitting**: Some tools should recommend the user split changes into separate commits when diff touches unrelated areas
4. **Detect multiple scopes from file paths**: Parse diff file paths, detect top-level directories (e.g., `src/frontend/` vs `src/backend/`), suggest most relevant scope or let user choose

#### Practical approaches for an AI extension

- **Approach 1: Auto-detect scope from file paths** -- Parse changed files, find common parent directory, use as scope
- **Approach 2: LLM-inferred scope** -- Let the LLM decide scope based on what area of the codebase was primarily affected
- **Approach 3: Multi-commit suggestion** -- When diff clearly touches unrelated areas, suggest splitting into multiple commits
- **Approach 4: Configurable scope strategy** -- Let user choose: auto-detect, always-omit, always-specify, or pick-from-list

---

### 5. Commit Message Body Best Practices

#### When to Include a Body

| Scenario | Include Body? | Example |
|----------|---------------|---------|
| Simple one-liner change | No | `fix(auth): correct JWT expiration check` |
| Non-obvious WHY | Yes | Explain the reasoning behind the change |
| Breaking change | Yes (required) | Must include `BREAKING CHANGE:` description |
| Multi-file change with single intent | Optional | If subject captures intent, body is optional |
| Refactoring | Yes (recommended) | Explain what was restructured and why |
| Bug fix | Recommended | Explain root cause and how fix addresses it |

#### Body Content Guidelines

1. **Explain WHY, not WHAT** -- The diff already shows WHAT changed; the body should explain motivation
2. **Separate from subject with blank line** -- Git convention: first line is subject, blank line, then body
3. **Wrap at 72 characters** -- Git adds 4-char padding; 72 chars ensures readability in 80-col terminals
4. **Use imperative mood** -- Consistent with subject line ("Add caching" not "Added caching")
5. **Multiple paragraphs OK** -- For complex changes, use multiple paragraphs in the body
6. **Include ticket references in footer** -- e.g., `Closes #123` or `Refs: JIRA-456`

#### How AI tools handle the body

- **aicommits**: Never generates a body (title-only approach)
- **OpenCommit**: Configurable via `OCO_DESCRIPTION=true`. When enabled, instruction is: "Add a short description of WHY the changes are done after the commit message. Don't start it with 'This commit', just describe the changes."
- **OpenCommit one-line mode**: `OCO_ONE_LINE_COMMIT=true` forces single-line output even for complex changes

#### Recommended approach for VS Code extension

- **Default: generate subject + body** -- Subject line for quick scanning, body for context
- **Configurable: body mode** -- Options: `always`, `never`, `auto` (auto = include body when diff is complex or non-trivial)
- **Body should explain business context** -- Not just technical details from the diff

---

### 6. Configurable Commit Conventions

#### Convention Options Observed

| Convention | Format | Used By |
|-----------|--------|---------|
| Conventional Commits | `type(scope): description` | OpenCommit (default), aicommits, commitizen |
| Gitmoji | `:emoji: description` | aicommits, ai-commit (insulineru) |
| Conventional + Gitmoji | `:emoji: type(scope): description` | OpenCommit (OCO_EMOJI), cz-conventional-gitmoji, devmoji |
| Plain | `description` | aicommits (default), simple git messages |
| Custom | User-defined template | OpenCommit (OCO_MESSAGE_TEMPLATE_PLACEHOLDER), VS Copilot |
| @commitlint (project-specific) | Based on project commitlint config | OpenCommit (@commitlint module) |

#### How tools implement configurability

**aicommits**:
- `type` config: `plain | conventional | gitmoji`
- `--prompt` flag for one-off customization
- `locale` config for language
- `max-length` config for character limit

**OpenCommit**:
- `OCO_PROMPT_MODULE`: `conventional-commit | @commitlint`
- `OCO_EMOJI`: `true | false` (adds emoji prefix to conventional commit)
- `OCO_DESCRIPTION`: `true | false` (include body)
- `OCO_ONE_LINE_COMMIT`: `true | false`
- `OCO_OMIT_SCOPE`: `true | false`
- `OCO_LANGUAGE`: 18 supported languages
- `OCO_MESSAGE_TEMPLATE_PLACEHOLDER`: custom template with placeholder

**VS Copilot (Microsoft)**:
- Settings UI at Tools > Options > Copilot
- Text field for custom parameters
- Supports "Follow Conventional Commits standard" and "Use gitmoji"

**ai-commit (renatogalera)**:
- `{TICKET_ID}` template placeholder for ticket auto-detection
- Custom message templates

#### Recommended configuration surface for VS Code extension

```typescript
// Proposed settings structure
interface AiCommitConfig {
  // Convention type
  convention: 'conventional' | 'gitmoji' | 'conventional-gitmoji' | 'plain' | 'custom';
  
  // Scope behavior
  scope: 'auto' | 'omit' | 'always';
  scopeList?: string[]; // If 'always', restrict to these scopes
  
  // Body behavior
  body: 'always' | 'never' | 'auto';
  
  // Language
  locale: string; // e.g., 'en', 'zh-CN'
  
  // Max subject length
  maxSubjectLength: number; // default: 72
  
  // Custom prompt additions
  customPrompt?: string;
  
  // Custom template (with {message} placeholder)
  messageTemplate?: string; // e.g., "{TICKET_ID} {message}"
  
  // Ticket ID auto-detection from branch name
  ticketDetection: boolean;
}
```

---

### Files Found

| File Path | Description |
|---|---|
| `src/extension.ts` | Current scaffolded extension (helloWorld only) |
| `package.json` | Extension manifest with keywords: ai, commit, git, claude, openai, conventional, commit-message |
| `CLAUDE.md` | Project documentation |

### External References

- [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) -- Official specification
- [aicommits source](https://github.com/Nutlope/aicommits) -- Title-only AI commit CLI, 3 type modes
- [opencommit source](https://github.com/di-sukharev/opencommit) -- Full-featured AI commit CLI with body, gitmoji, commitlint
- [theorib/git-commit-message-ai-prompt](https://github.com/theorib/git-commit-message-ai-prompt) -- Dedicated prompt for conventional commit generation
- [ai-commit (chophe)](https://github.com/chophe/ai-commit) -- Supports Conventional Commits + Gitmoji + custom formats
- [ai-commit (renatogalera)](https://github.com/renatogalera/ai-commit) -- Ticket detection, git hooks, message templates
- [cz-conventional-gitmoji](https://github.com/ljnsn/cz-conventional-gitmoji) -- Commitizen plugin combining gitmoji and conventional commits
- [VS Copilot commit customization](https://devblogs.microsoft.com/visualstudio/customize-your-ai-generated-git-commit-messages/) -- Microsoft's approach to configurable AI commits
- [OEP-51 Conventional Commits](https://open-edx-proposals.readthedocs.io/en/latest/best-practices/oep-0051-bp-conventional-commits.html) -- Type priority order when commits mix types
- [Conventional Commits Cheatsheet](https://gist.github.com/qoomon/5dfcdf8eec66a051ecd85625518cfd13) -- Quick reference with all types

### Related Specs

- `.trellis/spec/frontend/index.md` -- Frontend spec index
- `.trellis/spec/guides/index.md` -- Guides spec index

## Caveats / Not Found

- **No tool explicitly handles multi-scope changes** -- All existing tools either pick a single scope or omit scope. No tool generates `feat(frontend,backend):` style messages or suggests splitting.
- **aicommits default is `plain` not `conventional`** -- Important UX note: most users expect conventional by default.
- **Body generation quality varies** -- LLM-generated bodies can hallucinate reasoning. Few-shot examples (OpenCommit approach) improve consistency significantly.
- **Commitlint integration is advanced** -- OpenCommit's `@commitlint` module reads project commitlint config and generates matching few-shot examples. This is powerful but adds complexity.
- **Ticket/issue detection from branch names** (renatogalera/ai-commit) is a valuable feature not commonly found in other tools.
- **Theorib's prompt repository** returned 404 for the actual prompt content; only the README description was accessible via search results.
