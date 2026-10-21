import type * as AgentSdk from '@anthropic-ai/claude-agent-sdk';

export type { AgentSdk };

let loading: Promise<typeof AgentSdk> | undefined;

/**
 * The Agent SDK is an ES module and starts a separate Claude Code process,
 * so it is only loaded the first time a conversation needs it.
 */
export function loadAgentSdk(): Promise<typeof AgentSdk> {
	loading ??= import('@anthropic-ai/claude-agent-sdk');
	return loading;
}
