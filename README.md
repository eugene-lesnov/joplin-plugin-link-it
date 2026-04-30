# `joplin-plugin-link-it`

A [Joplin](https://joplinapp.org) plugin for fast inline note linking from the editor.

## Features

- `[[` triggers an autocomplete with title-prefix search and notebook path preview.
- Inserts a note link in the form `[Title](:/<id>)`.
- Creates a new note from the autocomplete when nothing matches.
- Localization support.

## Requirements

- Joplin **3.5+** (CodeMirror 6 editor).

## Usage

Type `[[` and start typing a note title. Pick an entry from the list to insert the link. With an empty query, the most recently modified notes are shown. When no match is found, the list offers a "Create" option.

## Settings

- **Default notebook for new notes**: path (e.g. `Inbox` or `Projects/Active`) where notes created from the autocomplete are placed. If empty or not found, note creation is disabled (Joplin requires every note to belong to a notebook).

## Installation

- **Plugin repository**: `Tools -> Options -> Plugins`, find `Link It`, install and restart Joplin.
- **Manual**: build the `.jpl` with `npm run dist` and install it via `Tools -> Options -> Plugins -> Install from file`.

## Development

```bash
npm install
npm run dist
```

The build produces a publishable artifact in `publish/`.

## License

[MIT](LICENSE)
