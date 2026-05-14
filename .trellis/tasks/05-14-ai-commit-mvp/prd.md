# MVP: AI 生成 Git Commit Message

## Goal

在 VS Code Git 面板中添加一键生成按钮，调用本地 Claude CLI 分析 staged diff，生成规范的 Conventional Commit 消息，填入 commit input box。用户无需额外 API 密钥，复用已有 Claude 订阅认证。

## What I already know

* 项目已初始化 VS Code 插件工程，能正常构建、打包、运行
* 当前仅有 helloWorld 脚手架命令，需替换为 AI commit 生成功能
* VS Code Git API (`vscode.git`) 是稳定 API，可通过 `getAPI(1)` 访问
* `scm/title` 菜单是稳定 API，可在 Git 面板标题栏添加按钮
* `scm/inputBox` 是 proposed API，不能发布到 marketplace
* Claude CLI (`claude -p`) 是唯一能复用用户订阅认证的调用方式
* `--bare` 模式跳过 hooks 但也跳过 OAuth 认证，不能用于订阅用户
* 无 `--bare` 时 hooks 会加载（如 Trellis），可能注入无关上下文
* Conventional Commits 是行业标准，feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert
* OpenCommit 的 few-shot + body 模式生成质量最佳
* 已有参考实现：uaoa/claude-commit-vscode（scm/title + claude CLI）

## Assumptions (temporary)

* MVP 仅支持 Claude CLI，不支持其他 AI 提供商
* MVP 仅处理 staged changes，不处理 unstaged
* 用户已安装 Claude Code CLI 并完成认证
* 生成结果填入 inputBox，用户手动确认提交（不自动 commit）

## Open Questions

* Claude CLI 调用方式：`--bare`（干净输出但无订阅认证）vs 非 bare（有订阅但 hooks 可能干扰）?
* Diff 获取方式：VS Code Git API `repo.diff(true)` vs `git diff --cached` CLI?
* Commit message 格式：默认 Conventional Commits + body？还是可配置？
* 是否需要 streaming 进度反馈？

## Requirements (evolving)

* 在 Git SCM 面板标题栏添加 sparkle 按钮（scm/title）
* 点击按钮后，读取当前仓库的 staged diff
* 调用 Claude CLI 生成 Conventional Commit 消息
* 将生成结果填入 Git inputBox
* 无 staged changes 时给出提示
* Claude CLI 未安装/未认证时给出明确引导
* 生成过程中显示 loading 状态

## Acceptance Criteria (evolving)

* [ ] 点击 sparkle 按钮，staged diff 存在时生成 commit message 并填入 inputBox
* [ ] 无 staged changes 时显示 warning 提示
* [ ] Claude CLI 不可用时显示安装/认证引导
* [ ] 生成的 commit message 符合 Conventional Commits 格式
* [ ] 生成过程中有 loading 状态反馈

## Definition of Done

* Tests added/updated
* Lint / typecheck green
* 手动 F5 测试通过（正常流程 + 边界情况）
* Rollback plan: 插件为纯 UI 操作，不影响 git 数据，无需特殊 rollback

## Out of Scope (explicit)

* 支持 OpenAI/Gemini 等 API 提供商
* 自动执行 git commit
* 处理 unstaged changes
* commitlint 集成
* Gitmoji 模式
* 多仓库工作区支持（MVP 取第一个仓库）
* 自定义 prompt 模板
* Ticket ID 自动检测

## Technical Notes

### Research References

* [`research/vscode-git-api.md`](research/vscode-git-api.md) — VS Code Git API 集成方式，scm/title vs scm/inputBox，参考实现
* [`research/claude-cli-usage.md`](research/claude-cli-usage.md) — Claude CLI 调用方式，`claude -p` 参数，`--bare` vs 非 bare 认证差异
* [`research/commit-message-standards.md`](research/commit-message-standards.md) — Conventional Commits 规范，AI 工具 prompt 模式，few-shot 最佳实践

### Key Constraints

* `scm/inputBox` proposed API 不可用于 marketplace 发布
* `--bare` 模式下 Claude CLI 无法使用 OAuth 订阅认证
* VS Code 扩展进程不继承用户 shell 环境，需 `/bin/bash -l -c` 加载 PATH
* `git.d.ts` 类型定义需从 VS Code 源码复制，无 npm 包
* Claude CLI stdin 上限 10MB，大型 diff 需写临时文件
