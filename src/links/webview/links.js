(function () {
	const ROOT_SELECTOR = '[data-link-it-links]';
	const MSG_INIT = 'links.init';
	const MSG_UPDATE = 'links.update';
	const MSG_READY = 'links.ready';
	const MSG_OPEN = 'links.open';

	// Localized strings are populated on MSG_INIT before any rendering happens,
	// so no client-side fallbacks are needed here.
	let strings = null;

	function escapeHtml(value) {
		return String(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function format(template, values) {
		return template.replace(/\{(\w+)\}/g, function (match, key) {
			return values[key] !== undefined ? String(values[key]) : match;
		});
	}

	function renderHeader(totalCount) {
		const counter = totalCount > 0 ? ' <span class="link-it-links__count">' + totalCount + '</span>' : '';
		return '<h3 class="link-it-links__title">' + escapeHtml(strings.panelTitle) + counter + '</h3>';
	}

	function renderEmptyState(message) {
		return '<div class="link-it-links__empty">' + escapeHtml(message) + '</div>';
	}

	function renderItem(item) {
		const isMissing = !!item.missing;
		const refsBadge = item.refsCount > 1
			? '<span class="link-it-links__refs" title="' +
				escapeHtml(format(strings.refs, { count: item.refsCount })) +
				'">' + item.refsCount + '</span>'
			: '';

		const path = !isMissing && item.notebookPath
			? '<div class="link-it-links__path">' + escapeHtml(item.notebookPath) + '</div>'
			: '';

		const titleText = isMissing
			? escapeHtml(item.title) + ' <span class="link-it-links__missing-tag">' +
				escapeHtml(strings.missingSuffix) + '</span>'
			: escapeHtml(item.title);

		// Missing items are rendered as a div: not interactive (no openNote available).
		const tag = isMissing ? 'div' : 'button';
		const interactiveAttrs = isMissing
			? 'class="link-it-links__item link-it-links__item--missing"'
			: 'type="button" class="link-it-links__item" data-note-id="' + escapeHtml(item.id) + '"';

		return (
			'<' + tag + ' ' + interactiveAttrs + '>' +
				'<div class="link-it-links__row">' +
					'<span class="link-it-links__item-title">' + titleText + '</span>' +
					refsBadge +
				'</div>' +
				path +
			'</' + tag + '>'
		);
	}

	function renderSection(titleText, count, items, emptyMessage) {
		const titleHtml = '<h4 class="link-it-links__section-title">' +
			escapeHtml(titleText) +
			(count > 0 ? ' <span class="link-it-links__count">' + count + '</span>' : '') +
			'</h4>';

		const bodyHtml = items.length
			? '<ul class="link-it-links__list">' +
				items.map(function (item) {
					return '<li>' + renderItem(item) + '</li>';
				}).join('') +
				'</ul>'
			: renderEmptyState(emptyMessage);

		return '<section class="link-it-links__section">' + titleHtml + bodyHtml + '</section>';
	}

	function renderBody(state, incoming, outgoing, showOutgoing) {
		switch (state) {
			case 'loading':
				return renderEmptyState(strings.loading);
			case 'no-note':
				return renderEmptyState(strings.noNote);
			case 'error':
				return renderEmptyState(strings.error);
			case 'ready': {
				const incomingHtml = renderSection(
					strings.incomingTitle, incoming.length, incoming, strings.incomingEmpty,
				);
				const outgoingHtml = showOutgoing
					? renderSection(
						strings.outgoingTitle, outgoing.length, outgoing, strings.outgoingEmpty,
					)
					: '';
				return incomingHtml + outgoingHtml;
			}
			default:
				return '';
		}
	}

	function update(state, incoming, outgoing, showOutgoing) {
		const root = document.querySelector(ROOT_SELECTOR);
		if (!root) return;

		const header = root.querySelector('.link-it-links__header');
		const body = root.querySelector('.link-it-links__body');

		const totalCount = state === 'ready'
			? incoming.length + (showOutgoing ? outgoing.length : 0)
			: 0;

		if (header) header.innerHTML = renderHeader(totalCount);
		if (body) body.innerHTML = renderBody(state, incoming, outgoing, showOutgoing);
	}

	function bindClicks() {
		const root = document.querySelector(ROOT_SELECTOR);
		if (!root) return;

		root.addEventListener('click', function (event) {
			const target = event.target instanceof Element
				? event.target.closest('.link-it-links__item')
				: null;
			if (!target) return;
			const noteId = target.getAttribute('data-note-id');
			if (!noteId) return;
			webviewApi.postMessage({ type: MSG_OPEN, noteId: noteId });
		});
	}

	function init() {
		bindClicks();

		webviewApi.onMessage(function (event) {
			const message = event && event.message;
			if (!message || typeof message !== 'object') return;

			if (message.type === MSG_INIT) {
				strings = message.strings || {};
				return;
			}

			if (message.type === MSG_UPDATE && strings) {
				update(
					message.state,
					message.incoming || [],
					message.outgoing || [],
					!!message.showOutgoing,
				);
			}
		});

		webviewApi.postMessage({ type: MSG_READY });
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
