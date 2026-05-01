const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

let supportedLanguages: string[] = [];

export interface AppLocalization {
	sectionLabel: string;
	notebookPathLabel: string;
	notebookPathDescription: string;
	createNoteLabel: string;
	createNoteDetailNotebook: string;
	createNoteDetailUnconfigured: string;
	createNoteDetailInvalid: string;
	linksShowOutgoingLabel: string;
	linksShowOutgoingDescription: string;
	linksPanelTitle: string;
	linksLoading: string;
	linksNoNoteSelected: string;
	linksError: string;
	linksRefsLabel: string;
	linksToggleLabel: string;
	linksIncomingTitle: string;
	linksOutgoingTitle: string;
	linksIncomingEmpty: string;
	linksOutgoingEmpty: string;
	linksMissingSuffix: string;
}

const defaultStrings: AppLocalization = {
	sectionLabel: 'Link It',
	notebookPathLabel: 'Default notebook for new notes',
	notebookPathDescription:
		'Path to the notebook where new notes are created from the autocomplete '
		+ '(e.g. "Inbox" or "Projects/Active"). '
		+ 'If the path is empty or not found, note creation from the autocomplete is disabled.',
	createNoteLabel: 'Create "{title}"',
	createNoteDetailNotebook: ' in {path}',
	createNoteDetailUnconfigured: 'Set the default notebook for new notes in Link It settings',
	createNoteDetailInvalid: 'Notebook "{path}" not found',
	linksShowOutgoingLabel: 'Show outgoing links',
	linksShowOutgoingDescription:
		'When enabled, the links panel also lists notes the current note links to.',
	linksPanelTitle: 'Links',
	linksLoading: 'Loading...',
	linksNoNoteSelected: 'No note selected',
	linksError: 'Failed to load links',
	linksRefsLabel: '{count} refs',
	linksToggleLabel: 'Toggle links panel',
	linksIncomingTitle: 'Backlinks',
	linksOutgoingTitle: 'Outgoing links',
	linksIncomingEmpty: 'No backlinks',
	linksOutgoingEmpty: 'No outgoing links',
	linksMissingSuffix: '(not found)',
};
const strings: AppLocalization = { ...defaultStrings };


const localizations: Record<string, Partial<AppLocalization>> = {
	ru: {
		sectionLabel: 'Link It',
		notebookPathLabel: 'Блокнот по умолчанию для новых заметок',
		notebookPathDescription:
			'Путь к блокноту, в котором создаются новые заметки из автодополнения '
			+ '(например, "Входящие" или "Проекты/Активные").'
			+ 'Если путь пуст или не найден, создание заметок из автодополнения отключается.',
		createNoteLabel: 'Создать "{title}"',
		createNoteDetailNotebook: ' в {path}',
		createNoteDetailUnconfigured: 'Укажите блокнот по умолчанию для новых заметок в настройках Link It',
		createNoteDetailInvalid: 'Блокнот "{path}" не найден',
		linksShowOutgoingLabel: 'Показывать исходящие ссылки',
		linksShowOutgoingDescription:
			'Когда включено, панель ссылок также показывает заметки, на которые ссылается текущая заметка.',
		linksPanelTitle: 'Ссылки заметки',
		linksLoading: 'Загрузка...',
		linksNoNoteSelected: 'Заметка не выбрана',
		linksError: 'Не удалось загрузить ссылки',
		linksRefsLabel: '{count} ссылок',
		linksToggleLabel: 'Переключить панель ссылок',
		linksIncomingTitle: 'Обратные ссылки',
		linksOutgoingTitle: 'Исходящие ссылки',
		linksIncomingEmpty: 'Обратных ссылок нет',
		linksOutgoingEmpty: 'Исходящих ссылок нет',
		linksMissingSuffix: '(не найдено)',
	},
};

const getNavigatorLanguages = (): readonly string[] => {
	if (typeof navigator === 'undefined') {
		return [];
	}

	if (navigator.languages?.length > 0) {
		return navigator.languages;
	}

	return navigator.language ? [navigator.language] : [];
};

const normalizeLocale = (locale: string): string => locale.replace('_', '-');

const getLanguageCode = (locale: string): string | undefined => {
	const localeSeparatorIndex = locale.indexOf('-');

	return localeSeparatorIndex === -1 ? undefined : locale.substring(0, localeSeparatorIndex);
};

const getSupportedLanguages = (locales: readonly string[]): string[] => {
	const languages: string[] = [];

	for (const locale of locales) {
		const normalizedLocale = normalizeLocale(locale);
		languages.push(normalizedLocale);

		const languageCode = getLanguageCode(normalizedLocale);

		if (languageCode) {
			languages.push(languageCode);
		}
	}

	return languages;
};

const findLocalization = (languages: readonly string[]): Partial<AppLocalization> => {
	for (const language of languages) {
		const localization = localizations[language];

		if (localization) {
			return localization;
		}
	}

	return {};
};

const applyLocalization = (localization: Partial<AppLocalization>) => {
	Object.assign(strings, defaultStrings, localization);
};

export const setLocale = (supportedLocales: readonly string[] | string) => {
	const locales = typeof supportedLocales === 'string' ? [supportedLocales] : supportedLocales;
	const languages = getSupportedLanguages(locales);

	supportedLanguages = languages;
	applyLocalization(findLocalization(languages));
};

setLocale(getNavigatorLanguages());

export const getLocales = () => {
	return [...supportedLanguages];
};

export const formatLocalizedString = (
	template: string,
	values: Record<string, string | number>,
): string => {
	return template.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
		const value = values[key];
		return value === undefined ? match : String(value);
	});
};

export default strings;
