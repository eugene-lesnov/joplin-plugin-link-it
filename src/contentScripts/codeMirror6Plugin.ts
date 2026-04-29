import { ContentScriptContext } from 'api/types';
import { AUTOCOMPLETE_TRIGGER, MSG_SEARCH_NOTES } from '../noteLink';

const MAX_VISIBLE_PATH_SEGMENTS = 3;
const PATH_ELLIPSIS = '...';
const PATH_SEPARATOR = '/';

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

			const completeNoteLink = async (completionContext: any) => {
				const prefix = completionContext.matchBefore(AUTOCOMPLETE_TRIGGER);
				if (!prefix) return null;
				if (prefix.from === prefix.to && !completionContext.explicit) return null;

				const searchText = prefix.text.startsWith('[[') ? prefix.text.slice(2) : prefix.text;

				const notes: { id: string; title: string; folderPath?: string }[] =
					(await context.postMessage({ command: MSG_SEARCH_NOTES, prefix: searchText })) ?? [];

				const options = notes.map(note => ({
					label: note.title,
					detail: note.folderPath ? truncatePath(note.folderPath) : undefined,
					apply: (view: any, _completion: any, from: number, to: number) => {
						const range = expandBracketsRange(view.state, from, to);
						const replacement = `[${note.title}](:/${note.id})`;
						view.dispatch({
							changes: { from: range.from, to: range.to, insert: replacement },
							selection: { anchor: range.from + replacement.length },
							userEvent: 'input.complete',
						});
					},
				}));

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
