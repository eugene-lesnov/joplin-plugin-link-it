import joplin from 'api';
import { ContentScriptType } from 'api/types';
import {
	EDITOR_CONTENT_SCRIPT_ID,
	MSG_SEARCH_NOTES,
} from './noteLink';

const AUTOCOMPLETE_LIMIT = 20;
// The page size when uploading folders in batch. 100 is the maximum that the Joplin Data API supports.
const FOLDERS_PAGE_LIMIT = 100;
const MAX_FOLDER_PAGES = 100;
const FOLDER_PATH_SEPARATOR = '/';

interface NoteSummary {
	id: string;
	title: string;
	parent_id?: string;
	folderPath?: string;
}

interface FolderInfo {
	title: string;
	parent_id: string;
}

class FolderPathResolver {
	private folders: Map<string, FolderInfo> | null = null;
	private loading: Promise<void> | null = null;
	// The number of the cache "generation". Incremented for each disability.
    // Running loadAll() remembers its generation and exits if it is outdated —
    // this protects against overwriting fresh data as a result of outdated loading.
	private generation = 0;

	public invalidate(): void {
		this.generation++;
		this.folders = null;
		this.loading = null;
	}

	public preload(): void {
		if (this.folders || this.loading) return;
		const gen = this.generation;
		this.loading = this.loadAll(gen)
			.catch(err => {
				console.warn('[Link It] failed to preload folders:', err);
			})
			.finally(() => {
				this.loading = null;
			});
	}

	// Synchronously returns the folder path ("Parent/Nested") from the already warmed cache
    // The cache is updated only by onNoteChange / onSyncComplete events
	public pathFor(parentId: string | undefined): string {
		if (!parentId || !this.folders) return '';
		const parts: string[] = [];
		const visited = new Set<string>();
		let currentId: string | undefined = parentId;
		while (currentId && !visited.has(currentId)) {
			visited.add(currentId);
			const folder = this.folders.get(currentId);
			if (!folder) return '';
			parts.unshift(folder.title);
			currentId = folder.parent_id || undefined;
		}
		return parts.join(FOLDER_PATH_SEPARATOR);
	}

	private async loadAll(gen: number): Promise<void> {
		const map = new Map<string, FolderInfo>();
		for (let page = 1; page <= MAX_FOLDER_PAGES; page++) {
			const result = await joplin.data.get(['folders'], {
				fields: ['id', 'title', 'parent_id'],
				limit: FOLDERS_PAGE_LIMIT,
				page,
			});
			if (gen !== this.generation) return;
			const items: { id: string; title: string; parent_id?: string }[] = result?.items ?? [];
			for (const f of items) {
				map.set(f.id, { title: f.title, parent_id: f.parent_id ?? '' });
			}
			if (!items.length) break;
			if (!result?.has_more) break;
		}
		if (gen !== this.generation) return;
		this.folders = map;
	}
}

async function searchNotesByTitle(folderPathResolver: FolderPathResolver, prefix: string): Promise<NoteSummary[]> {
	const trimmed = prefix.trim();
	let items: NoteSummary[];
	if (!trimmed) {
		const recent = await joplin.data.get(['notes'], {
			fields: ['id', 'title', 'parent_id'],
			order_by: 'updated_time',
			order_dir: 'DESC',
			limit: AUTOCOMPLETE_LIMIT,
		});
		items = recent?.items ?? [];
	} else {
		const result = await joplin.data.get(['search'], {
			query: `title:${trimmed}*`,
			fields: ['id', 'title', 'parent_id'],
			limit: AUTOCOMPLETE_LIMIT,
			type: 'note',
		});
		items = result?.items ?? [];
	}

	return items.map(note => ({
		...note,
		folderPath: folderPathResolver.pathFor(note.parent_id),
	}));
}

joplin.plugins.register({
	onStart: async () => {
		const folderPathResolver = new FolderPathResolver();
		folderPathResolver.preload();

		await joplin.workspace.onNoteChange(() => {
			folderPathResolver.invalidate();
			folderPathResolver.preload();
		});
		await joplin.workspace.onSyncComplete(() => {
			folderPathResolver.invalidate();
			folderPathResolver.preload();
		});

		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			EDITOR_CONTENT_SCRIPT_ID,
			'./contentScripts/codeMirror6Plugin.js',
		);

		await joplin.contentScripts.onMessage(EDITOR_CONTENT_SCRIPT_ID, async (message: any) => {
			if (!message || typeof message !== 'object') return null;
			if (message.command === MSG_SEARCH_NOTES) {
				return await searchNotesByTitle(folderPathResolver, String(message.prefix ?? ''));
			}
			return null;
		});
	},
});
