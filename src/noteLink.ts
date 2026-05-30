export const AUTOCOMPLETE_TRIGGER = /\[\[([^\[\]\n]*)$/;
export const EDITOR_CONTENT_SCRIPT_ID = 'com.github.eugenelesnov.LinkIt.editor';
export const MSG_SEARCH_NOTES = 'searchNotes';
export const MSG_CREATE_NOTE = 'createNote';

const MARKDOWN_LINK_TEXT_PATTERN = /[\[\]\\]/g;

export const createMarkdownNoteLink = (title: string, id: string): string => {
	const safeTitle = title.replace(MARKDOWN_LINK_TEXT_PATTERN, '\\$&');
	return `[${safeTitle}](:/${id})`;
};

export interface NoteOption {
	id: string;
	title: string;
	notebookPath?: string;
}

export type CreateOptionStatus = 'ready' | 'unconfigured' | 'invalid';

export interface CreateOption {
	label: string;
	detail: string;
	status: CreateOptionStatus;
}

export interface SearchNotesResponse {
	notes: NoteOption[];
	createOption: CreateOption | null;
}

export interface CreateNoteResponse {
	created: boolean;
	id?: string;
	title?: string;
}
