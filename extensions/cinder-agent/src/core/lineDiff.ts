export interface LineChangeCount {
	added: number;
	removed: number;
}

/**
 * Counts added and removed lines between two texts using the length of the
 * shortest edit script (Myers). If added + removed = D and
 * added - removed = newLines - oldLines, both counts follow from D alone.
 */
export function countLineChanges(before: string, after: string, maxEdits = 20_000): LineChangeCount {
	const a = splitLines(before);
	const b = splitLines(after);

	// Common prefix and suffix never contribute to the edit script.
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		start++;
	}
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}

	const n = endA - start;
	const m = endB - start;
	if (n === 0 || m === 0) {
		return { added: m, removed: n };
	}

	const d = editDistance(a, start, n, b, start, m, maxEdits);
	if (d === undefined) {
		// Too different to diff cheaply: report the changed region as a rewrite.
		return { added: m, removed: n };
	}
	return { added: (d + m - n) / 2, removed: (d - m + n) / 2 };
}

function splitLines(text: string): string[] {
	if (text === '') {
		return [];
	}
	const lines = text.split(/\r?\n/);
	// A trailing newline does not start an extra line.
	if (lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}

function editDistance(
	a: string[], aOffset: number, n: number,
	b: string[], bOffset: number, m: number,
	maxEdits: number,
): number | undefined {
	const max = Math.min(n + m, maxEdits);
	const v = new Int32Array(2 * max + 2);
	const offset = max + 1;
	for (let d = 0; d <= max; d++) {
		for (let k = -d; k <= d; k += 2) {
			let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
				? v[offset + k + 1]
				: v[offset + k - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a[aOffset + x] === b[bOffset + y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				return d;
			}
		}
	}
	return undefined;
}
