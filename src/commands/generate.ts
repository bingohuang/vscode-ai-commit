import * as vscode from 'vscode';
import { getGitRepository, getDiff, hasChanges } from '../services/git-service';
import { generateCommitMessage, findClaudeCli, resetCliCache } from '../services/claude-cli';
import { log, logError, logDebug, showOutput } from '../utils/logger';

export async function generateCommitMessageCommand(): Promise<void> {
	const repo = await getGitRepository();
	if (!repo) {
		vscode.window.showWarningMessage('No Git repository found in the current workspace.');
		return;
	}

	const repoRoot = repo.rootUri.fsPath;

	const cliPath = await findClaudeCli();
	if (!cliPath) {
		const install = 'Install Claude Code';
		const settings = 'Open Settings';
		const choice = await vscode.window.showErrorMessage(
			'Claude CLI not found. Install Claude Code or configure the path in Settings.',
			install,
			settings,
		);
		if (choice === install) {
			vscode.env.openExternal(vscode.Uri.parse('https://claude.ai/code'));
		} else if (choice === settings) {
			vscode.commands.executeCommand('workbench.action.openSettings', 'aiCommit.claudePath');
		}
		return;
	}

	const diffResult = await getDiff(repoRoot);
	if (!diffResult) {
		const hasAny = await hasChanges(repoRoot);
		if (hasAny) {
			vscode.window.showWarningMessage(
				'No diffable changes found. Untracked files cannot be analyzed. Stage your changes first.',
			);
		} else {
			vscode.window.showWarningMessage('No changes detected in the repository.');
		}
		return;
	}

	if (diffResult.source === 'unstaged') {
		const proceed = await vscode.window.showWarningMessage(
			'No staged changes found. Generate commit message from unstaged changes?',
			'Yes, use unstaged',
			'Cancel',
		);
		if (proceed !== 'Yes, use unstaged') {
			return;
		}
	}

	log(`Generating commit message from ${diffResult.source} diff...`);

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'AI Commit: Generating commit message...',
			cancellable: true,
		},
		async (progress, token) => {
			try {
				progress.report({ message: `Analyzing ${diffResult.source} changes...` });

				const message = await generateCommitMessage(diffResult.diff, repoRoot);

				if (token.isCancellationRequested) {
					return;
				}

				repo.inputBox.value = message;
				log(`Commit message filled into input box`);
				logDebug(`Message: ${message.substring(0, 100)}...`);

				vscode.window.showInformationMessage('AI Commit: Message generated successfully.');
			} catch (error) {
				logError('Failed to generate commit message', error);

				const msg = error instanceof Error ? error.message : String(error);
				const showLog = 'Show Log';
				const retry = 'Retry';
				const choice = await vscode.window.showErrorMessage(
					`AI Commit: ${msg}`,
					showLog,
					retry,
				);
				if (choice === showLog) {
					showOutput();
				} else if (choice === retry) {
					resetCliCache();
					await generateCommitMessageCommand();
				}
			}
		},
	);
}
