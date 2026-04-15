import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	type PluginValue,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import {
	EPICENTER_LINK_RE,
	type EpicenterLink,
	parseEpicenterLink,
} from '@epicenter/workspace';

/**
 * Configuration for the link decoration plugin.
 *
 * @example
 * ```typescript
 * linkDecorations({
 *   onNavigate: (ref) => fsState.selectFile(ref.id as FileId),
 *   resolveTitle: (ref) => fsState.getFile(ref.id as FileId)?.name ?? null,
 * })
 * ```
 */
type LinkDecorationConfig = {
	/** Called when a decorated epicenter link is clicked. */
	onNavigate: (ref: EpicenterLink) => void;
	/**
	 * Optional title resolver for epicenter links.
	 *
	 * When provided and it returns a non-null value, the widget displays the
	 * resolved title instead of the stored markdown display text. This is useful
	 * when the target entity can be renamed after the link was inserted.
	 *
	 * @example
	 * ```typescript
	 * resolveTitle: (ref) => {
	 *   if (ref.table !== 'files') return null;
	 *   return fsState.getFile(ref.id as FileId)?.name ?? null;
	 * }
	 * ```
	 */
	resolveTitle?: (ref: EpicenterLink) => string | null;
};

/**
 * Widget that renders an epicenter link as a clickable styled span.
 *
 * Replaces the full markdown link match in the document with a compact,
 * styled span showing just the display text or the current resolved title.
 * This keeps the stored markdown stable while letting the editor show a more
 * human-friendly label for the target entity.
 *
 * @example
 * ```typescript
 * const widget = new EpicenterLinkWidget('Daily Notes', {
 *   workspace: 'opensidian',
 *   table: 'files',
 *   id: 'abc123',
 * }, {
 *   onNavigate: (ref) => fsState.selectFile(ref.id as FileId),
 *   resolveTitle: (ref) => fsState.getFile(ref.id as FileId)?.name ?? null,
 * });
 * ```
 */
class EpicenterLinkWidget extends WidgetType {
	constructor(
		private readonly displayText: string,
		private readonly ref: EpicenterLink,
		private readonly config: LinkDecorationConfig,
	) {
		super();
	}

	override toDOM(): HTMLElement {
		const span = document.createElement('span');
		const resolvedTitle = this.config.resolveTitle?.(this.ref);
		span.textContent = resolvedTitle ?? this.displayText;
		span.className = 'cm-epicenter-link';
		span.style.cssText =
			'text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); text-underline-offset: 2px; cursor: pointer; color: var(--primary, #3b82f6);';
		span.title = resolvedTitle ?? this.displayText;

		span.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.config.onNavigate(this.ref);
		});

		return span;
	}

	override eq(other: EpicenterLinkWidget): boolean {
		return (
			this.displayText === other.displayText &&
			this.ref.workspace === other.ref.workspace &&
			this.ref.table === other.ref.table &&
			this.ref.id === other.ref.id
		);
	}
}

/**
 * Check whether a position falls inside a code block or inline code span.
 *
 * Uses the CodeMirror syntax tree to detect `FencedCode`, `InlineCode`,
 * and `CodeBlock` node types.
 */
function isInsideCode(view: EditorView, pos: number): boolean {
	let isCode = false;
	syntaxTree(view.state).iterate({
		from: pos,
		to: pos,
		enter(node) {
			const name = node.type.name;
			if (
				name === 'FencedCode' ||
				name === 'InlineCode' ||
				name === 'CodeBlock'
			) {
				isCode = true;
				return false;
			}
		},
	});
	return isCode;
}

/**
 * Build decorations for all visible epicenter links in the editor.
 *
 * Scans visible ranges for markdown links that point at `epicenter://`
 * epicenter links, skips matches inside code blocks, and creates
 * `Decoration.replace` widgets for each.
 *
 * @example
 * ```typescript
 * const decorations = buildDecorations(view, {
 *   onNavigate: (ref) => console.log(ref.workspace, ref.table, ref.id),
 *   resolveTitle: (ref) => ref.table === 'files' ? ref.id : null,
 * });
 * ```
 */
function buildDecorations(
	view: EditorView,
	config: LinkDecorationConfig,
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();

	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		let match: RegExpExecArray | null;
		EPICENTER_LINK_RE.lastIndex = 0;

		while (true) {
			match = EPICENTER_LINK_RE.exec(text);
			if (match === null) {
				break;
			}

			const start = from + match.index;
			const end = start + match[0].length;
			const displayText = match[1];
			const href = match[2];

			if (displayText === undefined || href === undefined) {
				continue;
			}

			if (isInsideCode(view, start)) continue;

			const ref = parseEpicenterLink(href);
			if (ref === null) continue;

			const widget = new EpicenterLinkWidget(displayText, ref, config);

			builder.add(start, end, Decoration.replace({ widget }));
		}
	}

	return builder.finish();
}

/**
 * Create a CodeMirror extension that decorates markdown epicenter links as
 * clickable styled spans.
 *
 * Scans visible document ranges for `[display text](epicenter://...)`
 * patterns, skips matches inside fenced code blocks and inline code, and
 * replaces each match with a styled widget showing just the display text or
 * a resolved title for the target entity.
 *
 * @example
 * ```typescript
 * import { linkDecorations } from './extensions/link-decorations';
 * import type { FileId } from '@epicenter/filesystem';
 *
 * const extensions = [
 *   linkDecorations({
 *     onNavigate: (ref) => fsState.selectFile(ref.id as FileId),
 *     resolveTitle: (ref) => fsState.getFile(ref.id as FileId)?.name ?? null,
 *   }),
 * ];
 * ```
 */
export function linkDecorations(config: LinkDecorationConfig) {
	return ViewPlugin.define(
		(view): PluginValue & { decorations: DecorationSet } => ({
			decorations: buildDecorations(view, config),
			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = buildDecorations(update.view, config);
				}
			},
		}),
		{
			decorations: (plugin) => plugin.decorations,
		},
	);
}
