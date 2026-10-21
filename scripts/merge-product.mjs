// Merges Cinder's product.json into the upstream VS Code product.json.
// Usage: node scripts/merge-product.mjs <cinder product.json> <vscode product.json>
import { readFileSync, writeFileSync } from 'node:fs';

const [overridesPath, targetPath] = process.argv.slice(2);
if (!overridesPath || !targetPath) {
	console.error('Usage: merge-product.mjs <overrides> <target>');
	process.exit(1);
}

const overrides = JSON.parse(readFileSync(overridesPath, 'utf8'));
const target = JSON.parse(readFileSync(targetPath, 'utf8'));

writeFileSync(targetPath, JSON.stringify({ ...target, ...overrides }, null, '\t') + '\n');
console.log(`Merged ${Object.keys(overrides).length} product.json overrides`);
