import joplin from 'api';
import { ToolbarButtonLocation } from 'api/types';
import {
	LINKS_PANEL_ID,
	LINKS_TOGGLE_COMMAND,
	LinksIncoming,
	LinksState,
	MSG_LINKS_INIT,
	MSG_LINKS_OPEN,
	MSG_LINKS_READY,
	MSG_LINKS_UPDATE,
	NoteLink,
} from './linksTypes';
import { LinksService } from './linksService';
import strings from '../localization';
import { getShowNoteLinks } from '../settings';

const PANEL_HTML = `
	<div class="link-it-links" data-link-it-links>
		<div class="link-it-links__header"></div>
		<div class="link-it-links__body"></div>
	</div>
`;

export class LinksPanel {
	private handle: string | null = null;
	private currentNoteId: string | null = null;
	private requestSeq = 0;
	private webviewReady = false;

	constructor(private readonly service: LinksService) {}

	public async register(): Promise<void> {
		this.handle = await joplin.views.panels.create(LINKS_PANEL_ID);

		await joplin.views.panels.addScript(this.handle, './links/webview/links.js');
		await joplin.views.panels.addScript(this.handle, './links/webview/links.css');
		await joplin.views.panels.setHtml(this.handle, this.renderHtml());

		await this.registerToggleCommand();

		await joplin.views.panels.onMessage(this.handle, async (message: LinksIncoming) => {
			if (!message || typeof message !== 'object') return null;

			if (message.type === MSG_LINKS_READY) {
				this.webviewReady = true;
				await this.sendInit();
				await this.refreshCurrent();
				return null;
			}

			if (message.type === MSG_LINKS_OPEN) {
				if (message.noteId) {
					await joplin.commands.execute('openNote', message.noteId);
				}
				return null;
			}

			return null;
		});
	}

	public async setCurrentNote(noteId: string | null): Promise<void> {
		this.currentNoteId = noteId;
		// Drop stale cache for the freshly selected note: while the user was on another note,
		// some of its linked targets could have been deleted without onNoteChange firing for them
		// (Joplin only forwards onNoteChange events for the currently selected note).
		if (noteId) this.service.invalidateNote(noteId);
		await this.refreshCurrent();
	}

	public async syncVisibility(): Promise<boolean> {
		if (!this.handle) return false;
		const showLinks = await getShowNoteLinks();
		if (showLinks) {
			await joplin.views.panels.show(this.handle);
		} else {
			await joplin.views.panels.hide(this.handle);
		}
		return showLinks;
	}

	public async refreshCurrent(): Promise<void> {
		if (!this.handle || !this.webviewReady) return;

		if (!await getShowNoteLinks()) {
			await joplin.views.panels.hide(this.handle);
			return;
		}

		if (!this.currentNoteId) {
			await this.postUpdate('no-note', [], []);
			return;
		}

		const seq = ++this.requestSeq;

		try {
			await this.postUpdate('loading', [], []);

			const noteId = this.currentNoteId;
			const [incoming, outgoing] = await Promise.all([
				this.service.getIncoming(noteId),
				this.service.getOutgoing(noteId),
			]);

			if (seq !== this.requestSeq) return;
			await this.postUpdate('ready', incoming, outgoing);
		} catch (err) {
			console.warn('[Link It] failed to load links:', err);
			if (seq !== this.requestSeq) return;
			await this.postUpdate('error', [], []);
		}
	}

	private async sendInit(): Promise<void> {
		if (!this.handle) return;
		joplin.views.panels.postMessage(this.handle, {
			type: MSG_LINKS_INIT,
			strings: {
				panelTitle: strings.linksPanelTitle,
				loading: strings.linksLoading,
				noNote: strings.linksNoNoteSelected,
				error: strings.linksError,
				refs: strings.linksRefsLabel,
				incomingTitle: strings.linksIncomingTitle,
				outgoingTitle: strings.linksOutgoingTitle,
				incomingEmpty: strings.linksIncomingEmpty,
				outgoingEmpty: strings.linksOutgoingEmpty,
				missingSuffix: strings.linksMissingSuffix,
			},
		});
	}

	private async postUpdate(
		state: LinksState,
		incoming: NoteLink[],
		outgoing: NoteLink[],
	): Promise<void> {
		if (!this.handle) return;
		joplin.views.panels.postMessage(this.handle, {
			type: MSG_LINKS_UPDATE,
			state,
			incoming,
			outgoing,
		});
	}

	private renderHtml(): string {
		return PANEL_HTML;
	}

	private async registerToggleCommand(): Promise<void> {
		if (!this.handle) return;
		const handle = this.handle;

		await joplin.commands.register({
			name: LINKS_TOGGLE_COMMAND,
			label: strings.linksToggleLabel,
			iconName: 'fas fa-exchange-alt',
			execute: async () => {
				if (!await getShowNoteLinks()) return;
				const visible = await joplin.views.panels.visible(handle);
				if (visible) {
					await joplin.views.panels.hide(handle);
				} else {
					await joplin.views.panels.show(handle);
				}
			},
		});

		await joplin.views.toolbarButtons.create(
			`${LINKS_TOGGLE_COMMAND}.button`,
			LINKS_TOGGLE_COMMAND,
			ToolbarButtonLocation.NoteToolbar,
		);
	}
}
