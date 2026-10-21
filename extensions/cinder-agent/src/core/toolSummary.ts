import { displayPath } from './paths';

export interface ToolLabel {
	/** Short label shown on the tool row, e.g. "Terminal". */
	name: string;
	/** What the tool acts on, e.g. a command or a file path. */
	summary: string;
}

export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

const LABELS: Record<string, string> = {
	Bash: 'Terminal',
	PowerShell: 'Terminal',
	Read: 'Read',
	Glob: 'Find files',
	Grep: 'Search',
	LS: 'List',
	Edit: 'Edit',
	MultiEdit: 'Edit',
	Write: 'Write',
	NotebookEdit: 'Notebook',
	WebFetch: 'Fetch',
	WebSearch: 'Web search',
	TodoWrite: 'Plan',
	Agent: 'Subagent',
	Task: 'Subagent',
	Skill: 'Skill',
};

export function describeTool(toolName: string, input: unknown, cwd?: string): ToolLabel {
	const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
	const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined);
	const file = str('file_path') ?? str('notebook_path') ?? str('path');

	let summary: string | undefined;
	switch (toolName) {
		case 'Bash':
		case 'PowerShell':
			summary = str('description') ?? str('command');
			break;
		case 'Glob':
			summary = str('pattern');
			break;
		case 'Grep':
			summary = str('pattern') && `"${str('pattern')}"${file ? ` in ${displayPath(file, cwd)}` : ''}`;
			break;
		case 'WebFetch':
			summary = str('url');
			break;
		case 'WebSearch':
			summary = str('query');
			break;
		case 'Agent':
		case 'Task':
			summary = str('description') ?? str('prompt');
			break;
		case 'TodoWrite': {
			const todos = Array.isArray(args.todos) ? args.todos.length : 0;
			summary = `${todos} ${todos === 1 ? 'step' : 'steps'}`;
			break;
		}
		case 'Skill':
			summary = str('skill') ?? str('command');
			break;
		default:
			summary = file ? displayPath(file, cwd) : undefined;
	}

	const name = LABELS[toolName] ?? (toolName.startsWith('mcp__') ? toolName.split('__').slice(1).join(': ') : toolName);
	return { name, summary: truncate(oneLine(summary ?? ''), 160) };
}

/** Full detail for permission prompts, e.g. the whole command. */
export function toolDetail(toolName: string, input: unknown): string | undefined {
	const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
	if ((toolName === 'Bash' || toolName === 'PowerShell') && typeof args.command === 'string') {
		return args.command;
	}
	if (toolName === 'WebFetch' && typeof args.url === 'string') {
		return args.url;
	}
	const json = JSON.stringify(args, null, 2);
	return json === '{}' ? undefined : truncate(json, 2000);
}

export function toolResultText(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map(block => (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string' ? block.text : ''))
			.filter(Boolean)
			.join('\n');
	}
	return '';
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
