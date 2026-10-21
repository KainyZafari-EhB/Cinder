// Bundles the extension host code and the webview UI.
//   node esbuild.mjs          one-off build
//   node esbuild.mjs --watch  rebuild on change
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const watch = process.argv.includes('--watch');
const root = import.meta.dirname;

/** @type {esbuild.BuildOptions} */
const extension = {
	entryPoints: [join(root, 'src/extension.ts')],
	outfile: join(root, 'dist/extension.js'),
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	sourcemap: true,
	// Shipped as a regular dependency: it locates its native Claude Code
	// binary at runtime, which does not survive bundling.
	external: ['vscode', '@anthropic-ai/claude-agent-sdk'],
	// Keep `import()` as a real dynamic import: the SDK is an ES module.
	supported: { 'dynamic-import': true },
	logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const webview = {
	entryPoints: { webview: join(root, 'webview/main.ts') },
	outdir: join(root, 'dist'),
	bundle: true,
	platform: 'browser',
	format: 'iife',
	target: 'chrome120',
	minify: !watch,
	sourcemap: watch,
	loader: { '.css': 'css' },
	logLevel: 'info',
};

copyFonts();

if (watch) {
	const contexts = await Promise.all([esbuild.context(extension), esbuild.context(webview)]);
	await Promise.all(contexts.map(context => context.watch()));
} else {
	await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
}

/** Copies the webview fonts (SIL Open Font License) from npm into media/fonts. */
function copyFonts() {
	const require = createRequire(import.meta.url);
	const out = join(root, 'media/fonts');
	mkdirSync(out, { recursive: true });
	const fonts = [
		['@fontsource-variable/bricolage-grotesque', 'bricolage-grotesque-latin-standard-normal.woff2', 'BricolageGrotesque.woff2'],
		['@fontsource-variable/jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2', 'JetBrainsMono.woff2'],
	];
	for (const [pkg, file, target] of fonts) {
		const dir = dirname(require.resolve(`${pkg}/package.json`));
		cpSync(join(dir, 'files', file), join(out, target));
	}
}
