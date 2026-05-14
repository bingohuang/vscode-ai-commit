# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VS Code extension for generating conventional Git commit messages via AI. Currently scaffolded (v0.0.1) with a placeholder `helloWorld` command.

## Commands

```bash
npm run compile    # Build (tsc -p ./)
npm run watch      # Watch mode (tsc -watch)
npm run lint       # Lint (eslint src)
npm test           # Run tests (compile + lint + vscode-test)
npm run package    # Build .vsix (vsce package)
```

Tests run inside VS Code host via `@vscode/test-electron`; test files match `out/test/**/*.test.js`.

## Architecture

- **Entry**: `src/extension.ts` → compiled to `out/extension.js`
- **Commands**: Registered in `package.json` `contributes.commands`, implemented in `activate()` export
- **Module system**: Node16 (ESM-style imports), target ES2022, strict mode
- **Linting**: typescript-eslint with `curly`, `eqeqeq`, `semi`, `no-throw-literal` as warnings

## Extension Development

- F5 in VS Code launches Extension Development Host (`.vscode/launch.json`)
- Extension ID prefix: `vscode-ai-commit`
- Minimum VS Code engine: `^1.110.0`