import { promises as fs } from 'node:fs';
import { countLineChanges } from '../core/lineDiff';

export interface EditRecord {
	/** The tool use that made the change; also the transcript item id. */
	id: string;
	path: string;
	/** File content before Claude's change, or null if Claude created the file. */
	before: string | null;
	/** File content right after Claude's change, or null if it was deleted. */
	after: string | null;
}

export interface CompletedEdit {
	record: EditRecord;
	added: number;
	removed: number;
	created: boolean;
}

export type UndoResult = 'undone' | 'changed-since' | 'unknown';

/**
 * Remembers what files looked like before Claude edited them, so every
 * change can be reviewed as a diff and undone.
 */
export class EditTracker {
	private readonly pending = new Map<string, { path: string; before: string | null }>();
	private readonly records = new Map<string, EditRecord>();

	async snapshot(id: string, path: string): Promise<void> {
		this.pending.set(id, { path, before: await readText(path) });
	}

	async complete(id: string): Promise<CompletedEdit | undefined> {
		const pending = this.pending.get(id);
		if (!pending) {
			return undefined;
		}
		this.pending.delete(id);
		const after = await readText(pending.path);
		if (after === pending.before) {
			return undefined; // the tool ran but nothing changed
		}
		const record: EditRecord = { id, path: pending.path, before: pending.before, after };
		this.records.set(id, record);
		const { added, removed } = countLineChanges(pending.before ?? '', after ?? '');
		return { record, added, removed, created: pending.before === null };
	}

	discard(id: string): void {
		this.pending.delete(id);
	}

	get(id: string): EditRecord | undefined {
		return this.records.get(id);
	}

	/**
	 * Restores the file to its content before the edit. Unless `force` is set,
	 * refuses when the file changed after Claude's edit, so later work by the
	 * user or by Claude is not silently thrown away.
	 */
	async undo(id: string, force = false): Promise<UndoResult> {
		const record = this.records.get(id);
		if (!record) {
			return 'unknown';
		}
		if (!force && (await readText(record.path)) !== record.after) {
			return 'changed-since';
		}
		if (record.before === null) {
			await fs.rm(record.path, { force: true });
		} else {
			await fs.writeFile(record.path, record.before, 'utf8');
		}
		return 'undone';
	}
}

async function readText(path: string): Promise<string | null> {
	try {
		return await fs.readFile(path, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}
