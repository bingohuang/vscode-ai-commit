# Add Claude Session Persistence and Session ID Tracking

## Goal

让插件每次调用 Claude CLI 时保留会话持久化，记录 session ID，用户可以在 VS Code 内查看历史会话记录，并通过 Claude CLI 恢复/查看特定会话。

## What I already know

* 当前 `src/services/claude-cli.ts:177` 使用 `--no-session-persistence` 禁用了会话保存
* Claude CLI 支持 `--session-id <uuid>` 指定自定义会话 ID
* 移除 `--no-session-persistence` 后，CLI 会自动将会话保存到 `~/.claude/projects/<project>/<session-id>.jsonl`
* CLI 的 JSON 输出已包含 `session_id`、`total_cost_usd`、`duration_ms`、`usage` 等元数据
* `--resume <session-id>` 可以恢复特定会话
* `--continue` 可以继续当前目录下最近的会话
* `--name <name>` 可以为会话设置显示名称
* 没有程序化的 `claude sessions list` 命令，需要读文件系统或使用交互式选择器
* `--bare` 模式下会话持久化仍然有效

## Assumptions

* 保留 `--bare` 模式（速度优先，不需要 OAuth 订阅认证）
* 会话 ID 由插件生成（`crypto.randomUUID()`）
* 用户通过 Claude CLI 自身（`claude -r` 或 `~/.claude/`）查看历史，插件不提供 UI

## Open Questions

(已收敛)

## Requirements

* 移除 `--no-session-persistence`，添加 `--session-id <uuid>` 让 CLI 保存会话
* 添加 `--name` 设置会话显示名称（如 "AI Commit: feat xxx"），方便在 `claude -r` 中识别
* 插件不存储历史、不提供查看 UI — 最轻量化

## Acceptance Criteria

* [ ] 每次调用 Claude CLI 时会话被持久化到磁盘
* [ ] 在 `claude -r` 交互选择器中能看到 AI Commit 的会话（有可识别的名称）
* [ ] 不引入明显的性能回退（预计 <0.3s 额外磁盘 I/O）

## Definition of Done

* Lint / typecheck 通过
* 功能在 VS Code Extension Development Host 中可验证
* 不引入明显的性能回退

## Out of Scope

* VS Code 内的历史记录 UI（QuickPick / WebView / TreeView）
* 会话恢复 / continue / resume 功能
* 累计花费统计
* 插件自身存储 session 元数据

## Technical Approach

修改 `src/services/claude-cli.ts` 中 `executeClaude()` 的 CLI 参数：

1. 移除 `--no-session-persistence`
2. 添加 `--session-id <uuid>`（`crypto.randomUUID()` 生成）
3. 添加 `--name "AI Commit"` 让会话在 `claude -r` 中有可识别的显示名称

预计性能影响：~0.1-0.3s 额外磁盘 I/O（会话 JSONL 写入）。

## Decision (ADR-lite)

**Context**: 用户希望在 Claude CLI 中查看 AI Commit 的历史会话，需要会话持久化
**Decision**: 最轻量化实现 — 仅修改 CLI 参数，不做任何 UI 或存储
**Consequences**: 历史查看依赖 Claude CLI 自身能力，插件侧无额外代码/状态维护
