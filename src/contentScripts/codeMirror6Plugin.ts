import { ContentScriptContext } from 'api/types';
import {
	AUTOCOMPLETE_TRIGGER,
	CreateNoteResponse,
	MSG_CREATE_NOTE,
	MSG_SEARCH_NOTES,
	SearchNotesResponse,
} from '../noteLink';

const MAX_VISIBLE_PATH_SEGMENTS = 3;
const PATH_ELLIPSIS = '...';
const PATH_SEPARATOR = '/';
// Boost so the synthetic "Create note" option lands at the bottom of the list.
const CREATE_OPTION_BOOST = -99;

const truncatePath = (path: string): string => {
	if (!path) return '';
	const segments = path.split(PATH_SEPARATOR);
	if (segments.length <= MAX_VISIBLE_PATH_SEGMENTS) return path;
	return `${segments[0]}${PATH_SEPARATOR}${PATH_ELLIPSIS}${PATH_SEPARATOR}${segments[segments.length - 1]}`;
};

export default (context: ContentScriptContext) => {
	return {
		plugin: (codeMirror: any) => {
			const expandBracketsRange = (state: any, from: number, to: number) => {
				const doc = state.doc;
				let start = from;
				let end = to;
				while (start > 0 && doc.sliceString(start - 1, start) === '[') start--;
				const docLen = doc.length;
				while (end < docLen && doc.sliceString(end, end + 1) === ']') end++;
				return { from: start, to: end };
			};

			const insertLink = (view: any, from: number, to: number, title: string, id: string) => {
				const range = expandBracketsRange(view.state, from, to);
				const replacement = `[${title}](:/${id})`;
				view.dispatch({
					changes: { from: range.from, to: range.to, insert: replacement },
					selection: { anchor: range.from + replacement.length },
					userEvent: 'input.complete',
				});
			};

			const completeNoteLink = async (completionContext: any) => {
				const prefix = completionContext.matchBefore(AUTOCOMPLETE_TRIGGER);
				if (!prefix) return null;
				if (prefix.from === prefix.to && !completionContext.explicit) return null;

				const searchText = prefix.text.startsWith('[[') ? prefix.text.slice(2) : prefix.text;

				const response: SearchNotesResponse =
					(await context.postMessage({ command: MSG_SEARCH_NOTES, prefix: searchText })) ?? {
						notes: [],
						createOption: null,
					};

				const options: any[] = response.notes.map(note => ({
					label: note.title,
					detail: note.notebookPath ? truncatePath(note.notebookPath) : undefined,
					apply: (view: any, _completion: any, from: number, to: number) => {
						insertLink(view, from, to, note.title, note.id);
					},
				}));

				if (response.createOption) {
					const trimmedTitle = searchText.trim();
					options.push({
						label: response.createOption.label,
						detail: response.createOption.detail,
						boost: CREATE_OPTION_BOOST,
						apply: (view: any, _completion: any, from: number, to: number) => {
							void (async () => {
								try {
									const response: CreateNoteResponse | null = await context.postMessage({
										command: MSG_CREATE_NOTE,
										title: trimmedTitle,
									});
									if (!response || !response.created || !response.id || !response.title) return;
									insertLink(view, from, to, response.title, response.id);
								} catch (err) {
									console.warn('[Link It] failed to create note:', err);
								}
							})();
						},
					});
				}

				return {
					from: prefix.from,
					options,
					filter: false,
				};
			};

			const extension = codeMirror.joplinExtensions?.completionSource
				? codeMirror.joplinExtensions.completionSource(completeNoteLink)
				: require('@codemirror/autocomplete').autocompletion({ override: [completeNoteLink] });

			codeMirror.addExtension(extension);
		},

		assets: () => [
			{ name: 'codeMirror6Plugin.css' },
		],
	};
};
