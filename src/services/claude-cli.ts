import { execFile } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { log, logDebug, logError } from '../utils/logger';

export interface ClaudeResult {
	type: 'result';
	subtype: string;
	is_error: boolean;
	result: string;
	session_id: string;
	total_cost_usd: number;
	usage: {
		input_tokens: number;
		output_tokens: number;
	};
}

export interface ClaudeCliOptions {
	prompt: string;
	systemPrompt: string;
	cwd: string;
	model: string;
}

const SYSTEM_PROMPT = `You are a commit message generator following the Conventional Commits specification (v1.0.0).

Rules:
- Format: <type>[optional scope]: <description>
  Optionally followed by a blank line and a <body> paragraph
- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Use imperative mood ("add feature" not "added feature")
- Subject line: max 72 characters
- Body: wrap at 72 characters, explain WHY not WHAT
- Include body when the change is non-trivial or the motivation is not obvious
- Do NOT include any explanations, introductions, or additional text
- Do NOT wrap the commit message in quotes or code blocks
- Output ONLY the commit message text, nothing else`;

const COMMIT_PROMPT_TEMPLATE = `Generate a conventional commit message for the following git diff.

Focus on what was changed and why, not just file names. Be specific: include concrete details (module names, functionality) rather than generic statements.

Git diff:
---
{diff}
---`;

let cachedCliPath: string | null = null;

export async function findClaudeCli(): Promise<string | null> {
	if (cachedCliPath !== null) {
		return cachedCliPath;
	}

	const config = vscode.workspace.getConfiguration('aiCommit');
	const configPath = config.get<string>('claudePath');
	if (configPath) {
		if (await isExecutable(configPath)) {
			cachedCliPath = configPath;
			log(`Using configured Claude path: ${configPath}`);
			return cachedCliPath;
		}
		log(`Configured Claude path not found: ${configPath}`);
	}

	const candidates = [
		'claude',
		path.join(os.homedir(), '.local', 'bin', 'claude'),
		'/usr/local/bin/claude',
		path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
	];

	for (const candidate of candidates) {
		if (await isExecutable(candidate)) {
			cachedCliPath = candidate;
			log(`Found Claude CLI at: ${candidate}`);
			return cachedCliPath;
		}
	}

	const homebrewPath = await findViaWhich();
	if (homebrewPath) {
		cachedCliPath = homebrewPath;
		log(`Found Claude CLI via which: ${homebrewPath}`);
		return cachedCliPath;
	}

	return null;
}

async function findViaWhich(): Promise<string | null> {
	return new Promise((resolve) => {
		execFile('/bin/bash', ['-l', '-c', 'which claude'], (err, stdout) => {
			if (err || !stdout.trim()) {
				resolve(null);
				return;
			}
			const p = stdout.trim();
			if (p && fs.existsSync(p)) {
				resolve(p);
			} else {
				resolve(null);
			}
		});
	});
}

async function isExecutable(filePath: string): Promise<boolean> {
	return new Promise((resolve) => {
		fs.access(filePath, fs.constants.X_OK, (err) => {
			resolve(!err);
		});
	});
}

export function resetCliCache(): void {
	cachedCliPath = null;
}

export async function generateCommitMessage(diff: string, cwd: string): Promise<string> {
	const cliPath = await findClaudeCli();
	if (!cliPath) {
		throw new Error(
			'Claude CLI not found. Please install Claude Code (https://claude.ai/code) or set the path in Settings > aiCommit.claudePath'
		);
	}

	const config = vscode.workspace.getConfiguration('aiCommit');
	const model = config.get<string>('model') || 'haiku';

	const prompt = COMMIT_PROMPT_TEMPLATE.replace('{diff}', diff);

	logDebug(`CWD: ${cwd}`);
	logDebug(`Diff length: ${diff.length} chars`);
	logDebug(`Model: ${model}`);

	const result = await executeClaude({
		prompt,
		systemPrompt: SYSTEM_PROMPT,
		cwd,
		model,
	});

	log(`Generated commit message (cost: $${result.total_cost_usd.toFixed(4)})`);
	logDebug(`Tokens: ${result.usage.input_tokens} in / ${result.usage.output_tokens} out`);

	return result.result.trim();
}

async function executeClaude(options: ClaudeCliOptions): Promise<ClaudeResult> {
	const { prompt, systemPrompt, cwd, model } = options;

	// Write prompt to a temp file to avoid shell escaping issues with large diffs.
	const promptFile = path.join(os.tmpdir(), `ai-commit-prompt-${Date.now()}.txt`);
	await fs.promises.writeFile(promptFile, prompt, { mode: 0o600 });

	const cliPath = cliPathForExec();
	const escapedCliPath = cliPath.includes(' ') ? `"${cliPath}"` : cliPath;

	// Optimized flags for speed:
	// --bare: skips hooks, LSP, plugin sync, CLAUDE.md discovery (~6-13s saved)
	// --model haiku: fastest model, sufficient for commit messages
	// --effort low: reduces reasoning time (~0.5-1s saved)
	// --output-format json: negligible overhead, gives us metadata
	// --no-session-persistence: skips disk I/O for session saving
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

	logDebug(`Executing: claude --print --bare --model ${model} ...`);

	return new Promise((resolve, reject) => {
		let execPath: string;
		let execArgs: string[];

		if (process.platform === 'win32') {
			const winArgs = args.map(winShellEscape).join(' ');
			execPath = 'cmd.exe';
			execArgs = ['/c', `type "${promptFile}" | ${escapedCliPath} ${winArgs}`];
		} else {
			const baseCommand = `cat "${promptFile}" | ${escapedCliPath} ${args.map(shellEscape).join(' ')}`;
			execPath = '/bin/bash';
			execArgs = ['-l', '-c', baseCommand];
		}

		execFile(
			execPath,
			execArgs,
			{
				cwd,
				maxBuffer: 10 * 1024 * 1024,
				timeout: 30_000,
				env: { ...process.env, CLAUDE_CODE_SIMPLE: '1' },
			},
			(err, stdout, stderr) => {
				fs.promises.unlink(promptFile).catch(() => { /* ignore cleanup errors */ });

				if (err) {
					logError(`Claude CLI execution failed`, err);
					if (stderr) {
						logError(`stderr: ${stderr}`);
					}
					reject(new Error(`Claude CLI error: ${err.message}`));
					return;
				}

				if (stderr) {
					logDebug(`Claude stderr: ${stderr.substring(0, 500)}`);
				}

				try {
					const result: ClaudeResult = JSON.parse(stdout);
					if (result.is_error) {
						logError(`Claude API error: ${result.subtype}`);
						reject(new Error(`Claude API error: ${result.subtype}`));
						return;
					}
					resolve(result);
				} catch {
					logDebug('JSON parse failed, treating stdout as plain text');
					const text = stdout.trim();
					if (text) {
						resolve({
							type: 'result',
							subtype: 'success',
							is_error: false,
							result: text,
							session_id: '',
							total_cost_usd: 0,
							usage: { input_tokens: 0, output_tokens: 0 },
						});
					} else {
						reject(new Error('Failed to parse Claude output and output was empty'));
					}
				}
			},
		);
	});
}

function cliPathForExec(): string {
	return cachedCliPath || 'claude';
}

/** POSIX shell escaping using single quotes. */
function shellEscape(arg: string): string {
	if (/^[a-zA-Z0-9_./:-]+$/.test(arg)) {
		return arg;
	}
	return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** Windows cmd.exe escaping using double quotes. */
function winShellEscape(arg: string): string {
	if (/^[a-zA-Z0-9_./:-]+$/.test(arg)) {
		return arg;
	}
	return `"${arg.replace(/"/g, '\\"')}"`;
}
