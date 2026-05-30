import joplin from 'api';
import { ContentScriptType } from 'api/types';
import {
	CreateNoteResponse,
	CreateOption,
	CreateOptionStatus,
	EDITOR_CONTENT_SCRIPT_ID,
	createMarkdownNoteLink,
	MSG_CREATE_NOTE,
	MSG_SEARCH_NOTES,
	NoteOption,
	SearchNotesResponse,
} from './noteLink';
import strings, { formatLocalizedString } from './localization';
import {
	SETTING_LINKS_SHOW,
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
const INSERT_NOTE_LINK_COMMAND = 'linkIt.insertNoteLink';
const INSERT_NOTE_LINK_DIALOG = 'linkIt.insertNoteLinkDialog';
const DIALOG_BUTTON_SELECT = 'select';
const DIALOG_BUTTON_CANCEL = 'cancel';
const DIALOG_FIELD_QUERY = 'query';
const DIALOG_FIELD_NOTE_ID = 'noteId';
const DIALOG_CREATE_NOTE_PREFIX = 'create:';
const EMPTY_QUERY = '';
const MAX_DIALOG_PATH_LENGTH = 80;

interface InsertNoteLinkChoice {
	id: string;
	title: string;
	createTitle?: string;
}

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

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function truncateDialogPath(path: string): string {
	if (path.length <= MAX_DIALOG_PATH_LENGTH) return path;
	return `${path.slice(0, MAX_DIALOG_PATH_LENGTH - 3)}...`;
}

function createChoiceLabel(note: NoteOption): string {
	if (!note.notebookPath) return note.title;
	return `${note.title} - ${truncateDialogPath(note.notebookPath)}`;
}

function parseDialogFormValue(value: unknown): string {
	if (Array.isArray(value)) return String(value[0] ?? '').trim();
	return String(value ?? '').trim();
}

async function getSelectedEditorText(): Promise<string> {
	try {
		const selected = await joplin.commands.execute('editor.execCommand', {
			name: 'getSelectedText',
			args: [],
		});
		return typeof selected === 'string' ? selected.trim() : EMPTY_QUERY;
	} catch (err) {
		console.warn('[Link It] failed to read selected text:', err);
		return EMPTY_QUERY;
	}
}

async function insertEditorText(text: string): Promise<void> {
	await joplin.commands.execute('editor.execCommand', {
		name: 'insertText',
		args: [text],
		value: text,
	});
}

async function resolveInsertNoteLinkChoice(
	notebookPathResolver: NotebookPathResolver,
	query: string,
): Promise<InsertNoteLinkChoice | null> {
	let currentQuery = query.trim();
	const dialog = await joplin.views.dialogs.create(INSERT_NOTE_LINK_DIALOG);
	await joplin.views.dialogs.setButtons(dialog, [
		{ id: DIALOG_BUTTON_SELECT, title: strings.insertNoteLinkCommandLabel },
		{ id: DIALOG_BUTTON_CANCEL, title: strings.cancelButtonLabel },
	]);

	while (true) {
		const response = await searchNotesByTitle(notebookPathResolver, currentQuery);
		const createValue = response.createOption?.status === 'ready'
			? `${DIALOG_CREATE_NOTE_PREFIX}${currentQuery}`
			: '';
		const optionsHtml = response.notes
			.map(note => `<option value="${escapeHtml(note.id)}">${escapeHtml(createChoiceLabel(note))}</option>`)
			.join('');
		const createOptionHtml = createValue
			? `<option value="${escapeHtml(createValue)}">${escapeHtml(response.createOption!.label + response.createOption!.detail)}</option>`
			: '';
		const statusText = response.notes.length || createOptionHtml
			? ''
			: (response.createOption ? strings.insertNoteLinkCreateUnavailable : strings.insertNoteLinkNoResults);

		await joplin.views.dialogs.setHtml(dialog, `
			<form name="linkItInsertNoteLink">
				<h3>${escapeHtml(strings.insertNoteLinkDialogTitle)}</h3>
				<label for="${DIALOG_FIELD_QUERY}">${escapeHtml(strings.insertNoteLinkQueryLabel)}</label>
				<input id="${DIALOG_FIELD_QUERY}" name="${DIALOG_FIELD_QUERY}" value="${escapeHtml(currentQuery)}" placeholder="${escapeHtml(strings.insertNoteLinkQueryPlaceholder)}" autofocus />
				<label for="${DIALOG_FIELD_NOTE_ID}">${escapeHtml(strings.insertNoteLinkResultLabel)}</label>
				<select id="${DIALOG_FIELD_NOTE_ID}" name="${DIALOG_FIELD_NOTE_ID}">
					<option value="">${escapeHtml(strings.insertNoteLinkResultPlaceholder)}</option>
					${optionsHtml}${createOptionHtml}
				</select>
				<p>${escapeHtml(statusText)}</p>
			</form>
		`);

		const result = await joplin.views.dialogs.open(dialog);
		if (result.id !== DIALOG_BUTTON_SELECT) return null;

		const formData = result.formData?.linkItInsertNoteLink ?? {};
		const selectedId = parseDialogFormValue(formData[DIALOG_FIELD_NOTE_ID]);
		const nextQuery = parseDialogFormValue(formData[DIALOG_FIELD_QUERY]);
		if (!selectedId && nextQuery !== currentQuery) {
			currentQuery = nextQuery;
			continue;
		}

		if (selectedId.startsWith(DIALOG_CREATE_NOTE_PREFIX)) {
			return {
				id: selectedId,
				title: response.createOption?.label ?? nextQuery,
				createTitle: selectedId.substring(DIALOG_CREATE_NOTE_PREFIX.length),
			};
		}

		const note = response.notes.find(item => item.id === selectedId);
		if (note) return { id: note.id, title: note.title };

		currentQuery = nextQuery;
	}
}

async function insertNoteLinkCommand(notebookPathResolver: NotebookPathResolver): Promise<void> {
	const selectedText = await getSelectedEditorText();
	const choice = await resolveInsertNoteLinkChoice(notebookPathResolver, selectedText);
	if (!choice) return;

	if (choice.createTitle) {
		const created = await createNote(notebookPathResolver, choice.createTitle);
		if (!created.created || !created.id || !created.title) return;
		await insertEditorText(createMarkdownNoteLink(created.title, created.id));
		return;
	}

	await insertEditorText(createMarkdownNoteLink(choice.title, choice.id));
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
		await linksPanel.syncVisibility();
		await linksPanel.setCurrentNote(initialNote ? initialNote.id : null);

		const invalidateAndRefresh = () => {
			notebookPathResolver.invalidate();
			notebookPathResolver.preload();
			linksService.invalidateAll();
			void linksPanel.refreshCurrent();
		};
		await joplin.workspace.onNoteChange(invalidateAndRefresh);
		await joplin.workspace.onSyncComplete(invalidateAndRefresh);

		await joplin.settings.onChange(async event => {
			if (event.keys.includes(SETTING_LINKS_SHOW)) {
				const visible = await linksPanel.syncVisibility();
				if (visible) await linksPanel.refreshCurrent();
			}
		});

		await joplin.commands.register({
			name: INSERT_NOTE_LINK_COMMAND,
			label: strings.insertNoteLinkCommandLabel,
			iconName: 'fas fa-link',
			execute: async () => {
				await insertNoteLinkCommand(notebookPathResolver);
			},
		});

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
