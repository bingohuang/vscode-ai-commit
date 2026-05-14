import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { log, logDebug, logError } from '../utils/logger';

export interface GitRepositoryInfo {
	rootUri: vscode.Uri;
	inputBox: { value: string };
}

export interface DiffResult {
	diff: string;
	source: 'staged' | 'unstaged';
}

export async function getGitRepository(): Promise<GitRepositoryInfo | null> {
	const gitExtension = vscode.extensions.getExtension('vscode.git');
	if (!gitExtension) {
		log('Git extension not found');
		return null;
	}

	if (!gitExtension.isActive) {
		await gitExtension.activate();
	}

	const api = gitExtension.exports.getAPI(1);
	if (!api || !api.repositories || api.repositories.length === 0) {
		log('No Git repositories found');
		return null;
	}

	const repo = api.repositories[0];
	return {
		rootUri: repo.rootUri,
		inputBox: repo.inputBox,
	};
}

export async function getStagedDiff(repoRoot: string): Promise<string | null> {
	return executeGitDiff(repoRoot, true);
}

export async function getUnstagedDiff(repoRoot: string): Promise<string | null> {
	return executeGitDiff(repoRoot, false);
}

async function executeGitDiff(repoRoot: string, cached: boolean): Promise<string | null> {
	const args = cached
		? ['diff', '--cached', '--unified=3', '--diff-algorithm=minimal']
		: ['diff', '--unified=3', '--diff-algorithm=minimal'];

	logDebug(`Running: git ${args.join(' ')} in ${repoRoot}`);

	return new Promise((resolve) => {
		execFile(
			'git',
			args,
			{ cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
			(err, stdout) => {
				if (err) {
					logError(`git diff failed (cached=${cached})`, err);
					resolve(null);
					return;
				}
				const rawDiff = stdout.trim();
				if (!rawDiff) {
					resolve(null);
					return;
				}
				const diff = stripDiffNoise(rawDiff);
				logDebug(`Got ${cached ? 'staged' : 'unstaged'} diff: ${rawDiff.length} -> ${diff.length} chars`);
				resolve(diff);
			}
		);
	});
}

const IGNORED_EXTENSIONS = new Set([
	'.lock', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot',
]);

function stripDiffNoise(diff: string): string {
	const blocks = diff.split(/(?=^diff --git )/m);
	const kept: string[] = [];

	for (const block of blocks) {
		const fileLineMatch = block.match(/^diff --git a\/(.+?) b\/(?:.+)$/m);
		if (fileLineMatch) {
			const filePath = fileLineMatch[1];
			const ext = filePath.substring(filePath.lastIndexOf('.'));
			if (IGNORED_EXTENSIONS.has(ext)) {
				continue;
			}
			// Skip lock-like file patterns (e.g. package-lock.json, pnpm-lock.yaml)
			if (filePath.endsWith('-lock.json') || filePath.endsWith('-lock.yaml')) {
				continue;
			}
		}
		// Remove "index abc123..def456 100644" lines (hash + mode, no value for AI)
		const cleaned = block.replace(/^index [0-9a-f]+\.\.\.[0-9a-f]+ \d+\n?/gm, '');
		kept.push(cleaned);
	}

	return kept.join('').trim();
}

export async function getDiff(repoRoot: string): Promise<DiffResult | null> {
	const stagedDiff = await getStagedDiff(repoRoot);
	if (stagedDiff) {
		return { diff: stagedDiff, source: 'staged' };
	}

	const unstagedDiff = await getUnstagedDiff(repoRoot);
	if (unstagedDiff) {
		return { diff: unstagedDiff, source: 'unstaged' };
	}

	return null;
}

export async function hasChanges(repoRoot: string): Promise<boolean> {
	return new Promise((resolve) => {
		execFile(
			'git',
			['status', '--porcelain'],
			{ cwd: repoRoot },
			(err, stdout) => {
				if (err) {
					logError('git status failed', err);
					resolve(false);
					return;
				}
				resolve(stdout.trim().length > 0);
			}
		);
	});
}
