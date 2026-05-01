import joplin from 'api';
import { NoteLink } from './linksTypes';

// Links service with a short TTL cache for both directions.
// We do not maintain a background index: links are fetched on demand.
// - Incoming: FTS search filtered precisely by exact link form in body.
// - Outgoing: parsed from the current note body, missing targets are kept and marked.

interface SourceNote {
	id: string;
	title: string;
	parent_id?: string;
	body?: string;
	updated_time?: number;
	deleted_time?: number;
}

interface CacheEntry {
	fetchedAt: number;
	items: NoteLink[];
}

export interface NotebookPathLookup {
	ensureLoaded(): Promise<void>;
	pathFor(parentId: string | undefined): string;
}

const CACHE_TTL_MS = 30_000;
const SEARCH_PAGE_LIMIT = 50;
const MAX_SEARCH_PAGES = 20;

// Matches a markdown link to a Joplin note: [display](:/<id>) optionally with #section.
// Joplin note IDs are 32 lowercase hex characters.
const ANY_NOTE_LINK_REGEX = /\[([^\]]*)\]\(:\/([a-f0-9]{32})(?:#[^)]*)?\)/gi;

function buildIncomingLinkRegex(noteId: string): RegExp {
	return new RegExp(`\\]\\(:\\/${escapeRegExp(noteId)}(?:#[^)]*)?\\)`, 'gi');
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class LinksService {
	private incomingCache = new Map<string, CacheEntry>();
	private outgoingCache = new Map<string, CacheEntry>();

	constructor(private readonly notebookPaths: NotebookPathLookup) {}

	public invalidateAll(): void {
		this.incomingCache.clear();
		this.outgoingCache.clear();
	}

	public async getIncoming(targetNoteId: string): Promise<NoteLink[]> {
		if (!targetNoteId) return [];
		return this.withCache(this.incomingCache, targetNoteId, () => this.fetchIncoming(targetNoteId));
	}

	public async getOutgoing(sourceNoteId: string): Promise<NoteLink[]> {
		if (!sourceNoteId) return [];
		return this.withCache(this.outgoingCache, sourceNoteId, () => this.fetchOutgoing(sourceNoteId));
	}

	private async withCache(
		cache: Map<string, CacheEntry>,
		key: string,
		loader: () => Promise<NoteLink[]>,
	): Promise<NoteLink[]> {
		const cached = cache.get(key);
		if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.items;
		const items = await loader();
		cache.set(key, { fetchedAt: Date.now(), items });
		return items;
	}

	// ----- Incoming (backlinks) -----

	private async fetchIncoming(targetNoteId: string): Promise<NoteLink[]> {
		// Joplin's FTS5 tokenizer does not always handle ":/<id>" reliably,
		// so we search without the ":/" prefix and then filter precisely with the regex.
		const sources = await this.searchSourceNotes(targetNoteId);
		await this.notebookPaths.ensureLoaded();

		const linkRegex = buildIncomingLinkRegex(targetNoteId);
		const results: NoteLink[] = [];

		for (const note of sources) {
			if (note.id === targetNoteId) continue;
			if (note.deleted_time && note.deleted_time > 0) continue;

			const body = note.body ?? '';
			linkRegex.lastIndex = 0;

			let match: RegExpExecArray | null;
			let refsCount = 0;
			while ((match = linkRegex.exec(body)) !== null) {
				refsCount++;
				if (match.index === linkRegex.lastIndex) linkRegex.lastIndex++;
			}

			if (refsCount === 0) continue;

			results.push({
				id: note.id,
				title: note.title,
				notebookPath: this.notebookPaths.pathFor(note.parent_id),
				refsCount,
				updatedTime: note.updated_time ?? 0,
			});
		}

		results.sort((a, b) => b.updatedTime - a.updatedTime);
		return results;
	}

	private async searchSourceNotes(targetNoteId: string): Promise<SourceNote[]> {
		const collected: SourceNote[] = [];
		const query = `/${targetNoteId}`;

		for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
			const result = await joplin.data.get(['search'], {
				query,
				type: 'note',
				fields: ['id', 'title', 'parent_id', 'body', 'updated_time', 'deleted_time'],
				limit: SEARCH_PAGE_LIMIT,
				page,
			});

			const items: SourceNote[] = result?.items ?? [];
			collected.push(...items);

			if (!items.length) break;
			if (!result?.has_more) break;
		}

		return collected;
	}

	// ----- Outgoing -----

	private async fetchOutgoing(sourceNoteId: string): Promise<NoteLink[]> {
		const source = await safeGetNote(sourceNoteId, ['body']);
		if (!source) return [];

		await this.notebookPaths.ensureLoaded();

		// Group occurrences by target id; remember first display text for missing-link fallback title.
		interface Occurrence {
			displayText: string;
			refsCount: number;
		}
		const occurrences = new Map<string, Occurrence>();
		const body = source.body ?? '';

		ANY_NOTE_LINK_REGEX.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = ANY_NOTE_LINK_REGEX.exec(body)) !== null) {
			const [, displayText, targetId] = match;
			if (targetId === sourceNoteId) continue;

			const existing = occurrences.get(targetId);
			if (existing) {
				existing.refsCount++;
			} else {
				occurrences.set(targetId, {
					displayText: displayText || '',
					refsCount: 1,
				});
			}
			if (match.index === ANY_NOTE_LINK_REGEX.lastIndex) ANY_NOTE_LINK_REGEX.lastIndex++;
		}

		// Resolve targets in parallel - Joplin data API is local SQLite, parallelism is safe and cheap.
		const entries = Array.from(occurrences.entries());
		const resolved = await Promise.all(entries.map(async ([targetId, occ]) => {
			const note = await safeGetNote(targetId, ['id', 'title', 'parent_id', 'updated_time', 'deleted_time']);
			const isMissing = !note || (note.deleted_time != null && note.deleted_time > 0);

			const link: NoteLink = isMissing
				? {
					id: targetId,
					title: occ.displayText || targetId,
					notebookPath: '',
					refsCount: occ.refsCount,
					updatedTime: 0,
					missing: true,
				}
				: {
					id: note!.id,
					title: note!.title,
					notebookPath: this.notebookPaths.pathFor(note!.parent_id),
					refsCount: occ.refsCount,
					updatedTime: note!.updated_time ?? 0,
				};
			return link;
		}));

		// Valid notes: by updated_time desc; missing notes go last, sorted by display text.
		resolved.sort((a, b) => {
			if (!!a.missing !== !!b.missing) return a.missing ? 1 : -1;
			if (a.missing && b.missing) return a.title.localeCompare(b.title);
			return b.updatedTime - a.updatedTime;
		});
		return resolved;
	}
}

// Fetches a note by id; returns null on any error (most commonly: note not found).
async function safeGetNote(noteId: string, fields: string[]): Promise<SourceNote | null> {
	try {
		const note = await joplin.data.get(['notes', noteId], { fields });
		return note ?? null;
	} catch {
		return null;
	}
}
