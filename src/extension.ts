import * as vscode from 'vscode';
import { generateCommitMessageCommand } from './commands/generate';
import { getOutputChannel } from './utils/logger';

export function activate(context: vscode.ExtensionContext) {
	const generateCmd = vscode.commands.registerCommand(
		'vscode-ai-commit.generate',
		() => generateCommitMessageCommand(),
	);

	context.subscriptions.push(generateCmd);
	context.subscriptions.push(getOutputChannel());
}

export function deactivate() {}
