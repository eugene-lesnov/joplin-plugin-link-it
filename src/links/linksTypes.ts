// Types and constants for the "Links" feature (incoming + outgoing).
// Shared between the plugin host, the service and the panel webview.

export const LINKS_PANEL_ID = 'com.github.eugenelesnov.LinkIt.linksPanel';
export const LINKS_TOGGLE_COMMAND = 'linkIt.toggleLinksPanel';

// Plugin -> webview messages.
export const MSG_LINKS_INIT = 'links.init';
export const MSG_LINKS_UPDATE = 'links.update';

// Webview -> plugin messages.
export const MSG_LINKS_READY = 'links.ready';
export const MSG_LINKS_OPEN = 'links.open';

// Top-level panel state. Per-section emptiness is rendered by the webview itself.
export type LinksState = 'loading' | 'ready' | 'no-note' | 'error';

export interface NoteLink {
	// For valid notes - the actual Joplin note id; for missing notes still the id from the link.
	id: string;
	title: string;
	notebookPath: string;
	refsCount: number;
	updatedTime: number;
	// True for outgoing links pointing to a deleted/missing target. Such items are non-clickable.
	missing?: boolean;
}

export interface LinksWebviewStrings {
	panelTitle: string;
	loading: string;
	noNote: string;
	error: string;
	refs: string;
	incomingTitle: string;
	outgoingTitle: string;
	incomingEmpty: string;
	outgoingEmpty: string;
	missingSuffix: string;
}

export interface LinksInitPayload {
	type: typeof MSG_LINKS_INIT;
	strings: LinksWebviewStrings;
}

export interface LinksUpdatePayload {
	type: typeof MSG_LINKS_UPDATE;
	state: LinksState;
	incoming: NoteLink[];
	outgoing: NoteLink[];
	showOutgoing: boolean;
}

export interface LinksOpenRequest {
	type: typeof MSG_LINKS_OPEN;
	noteId: string;
}

export interface LinksReadyRequest {
	type: typeof MSG_LINKS_READY;
}

export type LinksIncoming = LinksOpenRequest | LinksReadyRequest;
