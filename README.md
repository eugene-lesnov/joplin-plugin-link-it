# Link It

A plugin for [Joplin](https://joplinapp.org) that adds quick insertion of note links directly from the editor.

## Features

- Autocomplete trigger on `[[` in the CodeMirror 6 editor.
- Note search by title prefix with folder path preview.
- Inserts a native markdown link in the form `[Title](:/<id>)`.
- Folder cache warm-up and invalidation on note changes and sync.

## Requirements

- Joplin **3.5+** (CodeMirror 6 support).

## Installation

**From the plugin repository:** `Tools → Options → Plugins`, find `Link It`, install it and restart Joplin.

**Manually:** build the `.jpl` file with `npm run dist` and install it via `Tools → Options → Plugins → Install from file`.

## Usage

In the editor, type `[[` and then start typing a note title. Pick an item from the list — a ready-to-use link `[Title](:/id)` will be inserted. When the query is empty, the most recently modified notes are shown.

## Development

```bash
npm install
npm run dist
```

The build produces a publishable artifact in `publish/`.

## License

[MIT](LICENSE)
