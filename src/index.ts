import joplin from 'api';
import { ContentScriptType } from 'api/types';
import {
	CreateNoteResponse,
	CreateOption,
	CreateOptionStatus,
	EDITOR_CONTENT_SCRIPT_ID,
	MSG_CREATE_NOTE,
	MSG_SEARCH_NOTES,
	NoteOption,
	SearchNotesResponse,
} from './noteLink';
import strings, { formatLocalizedString } from './localization';
import {
	getDefaultNotebookPath,
	registerPluginSettings,
} from './settings';
import { LinksService } from './links/linksService';
import { LinksPanel } from './links/linksPanel';

const AUTOCOMPLETE_LIMIT = 20;
// Pool size for the recent-notes fallback used to compensate FTS indexing lag for freshly created notes.
const RECENT_NOTES_FALLBACK_LIMIT = 50;
// The page size when fetching notebooks in batch. 100 is the maximum that the Joplin Data API supports.
const NOTEBOOKS_PAGE_LIMIT = 100;
const MAX_NOTEBOOK_PAGES = 100;
const NOTEBOOK_PATH_SEPARATOR = '/';

type RawNote = { id: string; title: string; parent_id?: string };

async function fetchRecentNotes(limit: number): Promise<RawNote[]> {
	const recent = await joplin.data.get(['notes'], {
		fields: ['id', 'title', 'parent_id'],
		order_by: 'updated_time',
		order_dir: 'DESC',
		limit,
	});
	return recent?.items ?? [];
}

interface NotebookInfo {
	title: string;
	parent_id: string;
}

class NotebookPathResolver {
	private notebooks: Map<string, NotebookInfo> | null = null;
	private loading: Promise<void> | null = null;
	private generation = 0;

	public invalidate(): void {
		this.generation++;
		this.notebooks = null;
		this.loading = null;
	}

	public preload(): void {
		if (this.notebooks || this.loading) return;
		const gen = this.generation;
		this.loading = this.loadAll(gen)
			.catch(err => {
				console.warn('[Link It] failed to preload notebooks:', err);
			})
			.finally(() => {
				this.loading = null;
			});
	}

	public async ensureLoaded(): Promise<void> {
		if (this.notebooks) return;
		if (!this.loading) this.preload();
		if (this.loading) await this.loading;
	}

	// Synchronously returns the notebook path ("Parent/Nested") from the already warmed cache.
	// The cache is updated only by onNoteChange / onSyncComplete events.
	public pathFor(parentId: string | undefined): string {
		if (!parentId || !this.notebooks) return '';
		const parts: string[] = [];
		const visited = new Set<string>();
		let currentId: string | undefined = parentId;
		while (currentId && !visited.has(currentId)) {
			visited.add(currentId);
			const notebook = this.notebooks.get(currentId);
			if (!notebook) return '';
			parts.unshift(notebook.title);
			currentId = notebook.parent_id || undefined;
		}
		return parts.join(NOTEBOOK_PATH_SEPARATOR);
	}

	public findIdByPath(path: string): string | null {
		const segments = splitNotebookPath(path);
		if (!segments.length) return null;
		if (!this.notebooks) return null;

		let parentId = '';
		for (const segment of segments) {
			const target = segment.toLowerCase();
			let foundId: string | null = null;
			for (const [id, info] of this.notebooks) {
				if ((info.parent_id || '') === parentId && info.title.toLowerCase() === target) {
					foundId = id;
					break;
				}
			}
			if (!foundId) return null;
			parentId = foundId;
		}
		return parentId || null;
	}

	private async loadAll(gen: number): Promise<void> {
		const map = new Map<string, NotebookInfo>();
		for (let page = 1; page <= MAX_NOTEBOOK_PAGES; page++) {
			// Joplin Data API exposes notebooks under the "folders" resource for legacy reasons.
			const result = await joplin.data.get(['folders'], {
				fields: ['id', 'title', 'parent_id'],
				limit: NOTEBOOKS_PAGE_LIMIT,
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
		this.notebooks = map;
	}
}

function splitNotebookPath(path: string): string[] {
	return path
		.split(NOTEBOOK_PATH_SEPARATOR)
		.map(s => s.trim())
		.filter(s => s.length > 0);
}

async function searchNotesByTitle(
	notebookPathResolver: NotebookPathResolver,
	prefix: string,
): Promise<SearchNotesResponse> {
	const trimmed = prefix.trim();
	let items: RawNote[];
	if (!trimmed) {
		items = await fetchRecentNotes(AUTOCOMPLETE_LIMIT);
	} else {
		// Joplin FTS index lags behind note creation for several seconds, so freshly created notes
		// are invisible to ['search']. We compensate by also pulling the recent notes pool and
		// filtering it locally by title prefix; matches from this pool are placed on top so that
		// the just-created note is reachable immediately.
		const lowerPrefix = trimmed.toLowerCase();
		const [ftsResult, recentItems] = await Promise.all([
			joplin.data.get(['search'], {
				query: `title:${trimmed}*`,
				fields: ['id', 'title', 'parent_id'],
				limit: AUTOCOMPLETE_LIMIT,
				type: 'note',
			}),
			fetchRecentNotes(RECENT_NOTES_FALLBACK_LIMIT),
		]);
		const ftsItems: RawNote[] = ftsResult?.items ?? [];
		const recentMatches = recentItems.filter(n => (n.title ?? '').toLowerCase().startsWith(lowerPrefix));

		const seen = new Set<string>();
		items = [];
		for (const n of [...recentMatches, ...ftsItems]) {
			if (seen.has(n.id)) continue;
			seen.add(n.id);
			items.push(n);
			if (items.length >= AUTOCOMPLETE_LIMIT) break;
		}
	}

	const notes: NoteOption[] = items.map(note => ({
		id: note.id,
		title: note.title,
		notebookPath: notebookPathResolver.pathFor(note.parent_id),
	}));

	let createOption: CreateOption | null = null;
	if (trimmed && notes.length === 0) {
		const configuredPath = await getDefaultNotebookPath();
		const status = await resolveDefaultNotebookStatus(notebookPathResolver, configuredPath);
		createOption = {
			label: formatLocalizedString(strings.createNoteLabel, { title: trimmed }),
			detail: createOptionDetail(status, configuredPath),
			status,
		};
	}

	return { notes, createOption };
}

async function resolveDefaultNotebookStatus(
	notebookPathResolver: NotebookPathResolver,
	configuredPath: string,
): Promise<CreateOptionStatus> {
	if (!configuredPath) return 'unconfigured';
	await notebookPathResolver.ensureLoaded();
	return notebookPathResolver.findIdByPath(configuredPath) ? 'ready' : 'invalid';
}

function createOptionDetail(status: CreateOptionStatus, configuredPath: string): string {
	switch (status) {
		case 'ready':
			return formatLocalizedString(strings.createNoteDetailNotebook, { path: configuredPath });
		case 'invalid':
			return formatLocalizedString(strings.createNoteDetailInvalid, { path: configuredPath });
		case 'unconfigured':
			return strings.createNoteDetailUnconfigured;
	}
}

async function createNote(
	notebookPathResolver: NotebookPathResolver,
	title: string,
): Promise<CreateNoteResponse> {
	const trimmedTitle = title.trim();
	if (!trimmedTitle) return { created: false };

	const configuredPath = await getDefaultNotebookPath();
	const status = await resolveDefaultNotebookStatus(notebookPathResolver, configuredPath);
	if (status !== 'ready') return { created: false };

	const parentId = notebookPathResolver.findIdByPath(configuredPath);
	if (!parentId) return { created: false };

	const created = await joplin.data.post(['notes'], null, {
		title: trimmedTitle,
		parent_id: parentId,
	});

	return {
		created: true,
		id: created.id,
		title: created.title ?? trimmedTitle,
	};
}


joplin.plugins.register({
	onStart: async () => {
		const notebookPathResolver = new NotebookPathResolver();
		notebookPathResolver.preload();

		await registerPluginSettings();

		const linksService = new LinksService(notebookPathResolver);
		const linksPanel = new LinksPanel(linksService);
		await linksPanel.register();

		await joplin.workspace.onNoteSelectionChange(async event => {
			const noteId = event.value && event.value.length ? event.value[0] : null;
			await linksPanel.setCurrentNote(noteId);
		});

		const initialNote = await joplin.workspace.selectedNote();
		await linksPanel.setCurrentNote(initialNote ? initialNote.id : null);

		const invalidateAndRefresh = () => {
			notebookPathResolver.invalidate();
			notebookPathResolver.preload();
			linksService.invalidateAll();
			void linksPanel.refreshCurrent();
		};
		await joplin.workspace.onNoteChange(invalidateAndRefresh);
		await joplin.workspace.onSyncComplete(invalidateAndRefresh);

		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			EDITOR_CONTENT_SCRIPT_ID,
			'./contentScripts/codeMirror6Plugin.js',
		);

		await joplin.contentScripts.onMessage(EDITOR_CONTENT_SCRIPT_ID, async (message: any) => {
			if (!message || typeof message !== 'object') return null;

			if (message.command === MSG_SEARCH_NOTES) {
				return await searchNotesByTitle(notebookPathResolver, String(message.prefix ?? ''));
			}

			if (message.command === MSG_CREATE_NOTE) {
				return await createNote(notebookPathResolver, String(message.title ?? ''));
			}

			return null;
		});
	},
});
