/**
 * Environment for the Claude Code process behind a conversation. Variables
 * from any Claude Code session that launched Cinder (session ids, auth
 * tokens, API endpoints) would leak into it otherwise, so all CLAUDE* and
 * ANTHROPIC_* variables are dropped and only Cinder's API key is passed on.
 */
export function agentEnv(base: NodeJS.ProcessEnv, apiKey: string): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(base)) {
		if (!/^(CLAUDE|ANTHROPIC_|CCR_)/i.test(key)) {
			env[key] = value;
		}
	}
	env.ANTHROPIC_API_KEY = apiKey;
	return env;
}
