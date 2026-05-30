import joplin from 'api';
import { SettingItemType } from 'api/types';
import strings, { setLocale } from './localization';

export const SETTINGS_SECTION = 'linkIt';
export const SETTING_DEFAULT_NOTEBOOK_PATH = 'linkIt.defaultNewNoteNotebookPath';
export const SETTING_LINKS_SHOW = 'linkIt.links.show';

const LOCALE_GLOBAL_KEY = 'locale';

export async function applyJoplinLocale(): Promise<void> {
	const locale = await joplin.settings.globalValue(LOCALE_GLOBAL_KEY);
	if (typeof locale === 'string' && locale) {
		setLocale(locale);
	}
}

export async function registerPluginSettings(): Promise<void> {
	await applyJoplinLocale();

	await joplin.settings.registerSection(SETTINGS_SECTION, {
		label: strings.sectionLabel,
		iconName: 'fas fa-link',
	});

	await joplin.settings.registerSettings({
		[SETTING_DEFAULT_NOTEBOOK_PATH]: {
			value: '',
			type: SettingItemType.String,
			section: SETTINGS_SECTION,
			public: true,
			label: strings.notebookPathLabel,
			description: strings.notebookPathDescription,
		},
		[SETTING_LINKS_SHOW]: {
			value: true,
			type: SettingItemType.Bool,
			section: SETTINGS_SECTION,
			public: true,
			label: strings.linksShowLabel,
			description: strings.linksShowDescription,
		},
	});
}

export async function getDefaultNotebookPath(): Promise<string> {
	const raw = await joplin.settings.value(SETTING_DEFAULT_NOTEBOOK_PATH);
	return typeof raw === 'string' ? raw.trim() : '';
}

export async function getShowNoteLinks(): Promise<boolean> {
	const raw = await joplin.settings.value(SETTING_LINKS_SHOW);
	return typeof raw === 'boolean' ? raw : true;
}
