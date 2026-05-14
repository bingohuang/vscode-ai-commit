import * as vscode from 'vscode';

const CHANNEL_NAME = 'AI Commit';

let channel: vscode.OutputChannel;

export function getOutputChannel(): vscode.OutputChannel {
	if (!channel) {
		channel = vscode.window.createOutputChannel(CHANNEL_NAME);
	}
	return channel;
}

export function log(message: string): void {
	const ch = getOutputChannel();
	const timestamp = new Date().toISOString();
	ch.appendLine(`[${timestamp}] ${message}`);
}

export function logDebug(message: string): void {
	const config = vscode.workspace.getConfiguration('aiCommit');
	if (config.get<boolean>('debug')) {
		log(`[DEBUG] ${message}`);
	}
}

export function logError(message: string, error?: unknown): void {
	const ch = getOutputChannel();
	const timestamp = new Date().toISOString();
	ch.appendLine(`[${timestamp}] [ERROR] ${message}`);
	if (error instanceof Error) {
		ch.appendLine(`  ${error.message}`);
		if (error.stack) {
			ch.appendLine(`  ${error.stack}`);
		}
	} else if (error) {
		ch.appendLine(`  ${String(error)}`);
	}
}

export function showOutput(): void {
	getOutputChannel().show();
}
