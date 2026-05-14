# MVP: AI 生成 Git Commit Message

## Goal

在 VS Code Git 面板中添加一键生成按钮，调用本地 Claude CLI 分析 staged diff，生成规范的 Conventional Commit 消息，填入 commit input box。用户无需额外 API 密钥，复用已有 Claude 订阅认证。

## Requirements

### 核心功能
- 使用 Claude CLI (`claude`) 分析 git diff 并生成 Conventional Commits 格式提交信息
- 在 VS Code SCM 面板标题栏添加 sparkle 按钮触发（`scm/title`）
- 同时添加 Command Palette 入口
- 生成的消息自动填充到 commit input box
- 优先分析 staged changes，无 staged 时降级到 unstaged

### 技术要求
- TypeScript + VS Code Extension API
- 调用系统 claude CLI（非 Anthropic API）
- **不用 `--bare`**，复用用户订阅认证 + `--system-prompt` 覆盖减少 hooks 干扰
- `--print --output-format json` 获取结构化输出
- `--dangerously-skip-permissions` 避免权限弹窗
- Base64 编码 prompt 避免 shell 转义问题
- 智能检测 Claude CLI 路径（PATH、nvm、brew 等）
- 支持设置中自定义 Claude 路径配置
- 支持 Debug 模式（Output Channel 详细日志）
- 会话管理：`--session-id` + session name，每次生成提交是一个独立会话，在 Claude 中可查看历史
- 设置 `cwd` 为仓库根目录，确保会话历史保存到正确位置

### Conventional Commits 格式
- 支持类型：feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert
- 默认生成 subject + body（body 解释 WHY，非 WHAT）
- 祈使语气、subject ≤ 72 字符、body 行宽 72 字符

### 错误处理
- 无 staged 且无 unstaged changes 时显示 warning
- Claude CLI 未安装/未认证时显示安装/认证引导
- 生成过程中显示 progress 状态
- CLI 执行超时处理（120s）
- JSON 解析失败降级到纯文本输出

## Acceptance Criteria

- [ ] SCM 标题栏 sparkle 按钮可见（`when: scmProvider == git`）
- [ ] Command Palette 可搜索到 "AI Commit: Generate Message"
- [ ] 有 staged changes 时，点击按钮生成 commit message 并填入 inputBox
- [ ] 无 staged 但有 unstaged 时，降级使用 unstaged diff 生成
- [ ] 无任何 changes 时显示 warning
- [ ] Claude CLI 不可用时显示安装/认证引导
- [ ] 生成过程中有 progress 反馈
- [ ] 生成的 commit message 符合 Conventional Commits 格式（type + 可选 scope + description + 可选 body）
- [ ] 会话在 Claude CLI 历史中可追溯
- [ ] Debug 模式下 Output Channel 输出详细日志

## Definition of Done

* Tests added/updated
* Lint / typecheck green
* 手动 F5 测试通过（正常流程 + 边界情况）
* Rollback plan: 插件为纯 UI 操作，不影响 git 数据，无需特殊 rollback

## Decision (ADR-lite)

**Context**: Claude CLI 有 `--bare` 和非 bare 两种调用模式。`--bare` 速度快输出干净，但跳过 OAuth 认证无法复用订阅。非 bare 可用订阅但 hooks 可能干扰。

**Decision**: 使用非 `--bare` 模式 + `--system-prompt` 覆盖。理由：MVP 核心卖点是"无需额外 API 密钥"，`--bare` 违背此目标。`--system-prompt` 可减少 hooks 上下文注入的影响。

**Consequences**: 首次调用可能稍慢（hooks 加载），输出可能包含 hooks 注入的上下文，需在解析时处理。

## Out of Scope (explicit)

* 支持 OpenAI/Gemini 等 API 提供商
* 自动执行 git commit
* commitlint 集成
* Gitmoji 模式
* 多仓库工作区支持（MVP 取第一个仓库）
* 自定义 prompt 模板
* Ticket ID 自动检测
* streaming 实时输出

## Technical Approach

### 架构

```
src/
  extension.ts          # activate/deactivate, 注册命令
  commands/
    generate.ts         # 生成 commit message 的核心命令
  services/
    claude-cli.ts       # Claude CLI 检测、调用、输出解析
    git-service.ts      # Git 仓库信息获取、diff 提取
  utils/
    logger.ts           # Output Channel 日志工具
```

### 关键流程

1. 用户点击 SCM 按钮或 Command Palette → 触发 `vscode-ai-commit.generate`
2. `git-service.ts`: 获取仓库 → `git diff --cached`（有 staged）/ `git diff`（降级）
3. `claude-cli.ts`: 检测 CLI 路径 → 构建 prompt（Base64 编码） → 执行 `claude --print --output-format json --system-prompt "..." --dangerously-skip-permissions --session-id <uuid>`
4. 解析 JSON 输出 `result` 字段 → 填入 `repo.inputBox.value`

### Claude CLI 命令模板

```bash
claude --print \
  --output-format json \
  --system-prompt "You are a commit message generator..." \
  --dangerously-skip-permissions \
  --session-id <uuid> \
  --cwd <repo-root> \
  "<base64-encoded-prompt>"
```

### 会话管理

- 每次"生成 commit message"操作创建新 session（UUID v4）
- Session name 可通过 `--append-system-prompt` 或 metadata 标记
- `--cwd` 设为仓库根目录，确保 `.claude` 会话文件保存在正确位置

## Technical Notes

### Research References

* [`research/vscode-git-api.md`](research/vscode-git-api.md) — VS Code Git API 集成方式，scm/title 稳定 API，参考实现 uaoa/claude-commit-vscode
* [`research/claude-cli-usage.md`](research/claude-cli-usage.md) — Claude CLI `claude -p` 参数，`--output-format json`，非 bare 认证，hook 注入问题
* [`research/commit-message-standards.md`](research/commit-message-standards.md) — Conventional Commits 规范，OpenCommit few-shot prompt 最佳实践

### Key Constraints

* `scm/inputBox` proposed API 不可用于 marketplace → 用 `scm/title`
* VS Code 扩展不继承 shell 环境 → `/bin/bash -l -c` 加载 PATH
* `git.d.ts` 类型定义需从 VS Code 源码复制
* Claude CLI stdin 上限 10MB → 大 diff 写临时文件
* 无 `--bare` 时 hooks 可能注入上下文 → `--system-prompt` 覆盖 + 输出解析容错
