# 优化AI Commit生成速度至5秒内

## Goal

将插件生成 git commit message 的耗时从当前 10+ 秒优化到 5 秒以内，通过优化 Claude CLI 调用参数和 Diff 预处理实现。

## Requirements

* 生成 commit message 全流程耗时 < 5 秒（P50）
* 保持 Conventional Commits 格式输出
* 不降低生成质量
* 向后兼容现有配置（claudePath、debug）
* 仍使用 Claude CLI 调用方式，不做架构变更

## Acceptance Criteria

* [ ] 从触发命令到填入 commit input box 全程 < 5 秒
* [ ] 生成的 commit message 格式仍符合 Conventional Commits
* [ ] 现有配置项正常工作（claudePath、debug）
* [ ] Diff 预过滤掉 lock/binary/image 文件
* [ ] 大 diff 场景（> 500 行）仍有合理表现

## Definition of Done

* Lint / typecheck 通过
* 手动测试验证速度提升
* 边界情况处理（大 diff、CLI 未找到）

## Technical Approach

### 优化 1：CLI 标志优化（`claude-cli.ts`）

在 `buildCommandArgs()` 和 `executeClaude()` 中添加以下优化：

| 标志/变量 | 作用 | 预估提升 |
|---|---|---|
| `--bare` | 跳过 hooks/LSP/插件同步/CLAUDE.md 发现 | -6~13s |
| `--model haiku` | 使用最快模型 | -1~3s |
| `--effort low` | 降低推理强度 | -0.5~1s |
| `--output-format text` | 省去 JSON 序列化开销 | -0.3~0.5s |
| `--no-session-persistence` | 跳过 session 磁盘写入 | -0.1~0.3s |
| `CLAUDE_CODE_SIMPLE=1` env | 设置 CLI 简化模式 | 可能比 `--bare` 更快 |

综合效果：从 ~10-16s → ~2-5s

### 优化 2：Diff 预处理（`git-service.ts`）

| 策略 | 实现 |
|---|---|
| 排除 lock 文件 | 过滤 `package-lock.json`、`pnpm-lock.yaml`、`*.lock`、`*-lock.*` |
| 排除 binary/image | 过滤 `.svg`、`.png`、`.jpg`、`.jpeg`、`.webp`、`.gif`、`.ico` |
| 使用 minimal diff | `--diff-algorithm=minimal` |
| 清理 diff header | 去除 `index abc123..def456 100644` 等无价值行 |
| 大 diff 截断 | 超过阈值时使用 `git diff --stat` + 关键文件完整 diff |

### 配置项新增

```json
{
  "aiCommit.model": {
    "type": "string",
    "default": "haiku",
    "enum": ["haiku", "sonnet"],
    "description": "Claude model for commit message generation. Haiku is faster."
  }
}
```

## Out of Scope

* 直接 API 调用（SDK/fetch）— 后续可考虑
* 修改 UI/UX 流程
* 多语言 commit message 支持
* Streaming 输出
* Prompt Caching（system prompt 太短，不满足最低 1024 tokens）

## Technical Notes

* 核心文件：`src/services/claude-cli.ts`、`src/services/git-service.ts`、`src/commands/generate.ts`
* `--bare` 在 Claude CLI v2.1.88 可用
* `--effort` 在 Claude CLI v2.1.88 可用
* `--no-session-persistence` 仅在 `--print` 模式下有效
* Haiku 模型对 commit message 生成质量足够（参考 aicommits/opencommit 均使用小模型）
