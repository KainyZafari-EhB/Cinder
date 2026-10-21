import * as path from 'node:path';

/** Path relative to the project when it lives inside it, otherwise as given. */
export function displayPath(filePath: string, cwd: string | undefined): string {
	if (!cwd) {
		return filePath;
	}
	const relative = path.relative(cwd, filePath);
	if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
		return relative;
	}
	return filePath;
}

/** Resolves a tool's file path against the project folder. */
export function resolvePath(filePath: string, cwd: string): string {
	return path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
}

/** Normalizes folder paths so the same project compares equal. */
export function sameFolder(a: string, b: string): boolean {
	const normalize = (p: string) => {
		const resolved = path.resolve(p).replace(/[\\/]+$/, '');
		return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved;
	};
	return normalize(a) === normalize(b);
}

export function folderName(folder: string): string {
	return path.basename(folder.replace(/[\\/]+$/, '')) || folder;
}
