import {
	autocompletion,
	type Completion,
	type CompletionContext,
	type CompletionResult,
} from '@codemirror/autocomplete';
import { makeEpicenterLink } from '@epicenter/workspace';

/**
 * Configuration for the wikilink autocomplete extension.
 *
 * @example
 * ```typescript
 * wikilinkAutocomplete({
 *   workspaceId: 'opensidian',
 *   tableName: 'files',
 *   getFiles: () =>
 *     workspace.tables.files.getAllValid()
 *       .filter((r) => r.type === 'file')
 *       .map((r) => ({ id: r.id, name: r.name, parentId: r.parentId })),
 * })
 * ```
 */
type WikilinkAutocompleteConfig = {
	/** Workspace ID used to build `epicenter://` epicenter links. */
	workspaceId: string;
	/** Table name used to build `epicenter://` epicenter links. */
	tableName: string;
	/** Return all files available for linking. Called on every completion request. */
	getFiles: () => Array<{ id: string; name: string }>;
};

/**
 * CodeMirror CompletionSource that activates on `[[` and suggests epicenter links.
 *
 * When the user types `[[`, queries the configured file list, filters by
 * the characters typed after `[[`, and presents matching files. On selection,
 * deletes the `[[` trigger and inserts
 * `[File Name](epicenter://workspace/table/id)`.
 *
 * @example
 * ```typescript
 * const source = wikilinkCompletionSource({
 *   workspaceId: 'opensidian',
 *   tableName: 'files',
 *   getFiles: () => [{ id: 'abc123', name: 'Daily Notes' }],
 * });
 * ```
 */
function wikilinkCompletionSource(config: WikilinkAutocompleteConfig) {
	return (context: CompletionContext): CompletionResult | null => {
		// Look backwards from cursor for `[[` trigger
		const line = context.state.doc.lineAt(context.pos);
		const textBefore = line.text.slice(0, context.pos - line.from);
		const triggerIndex = textBefore.lastIndexOf('[[');

		if (triggerIndex === -1) return null;

		// Characters typed after `[[` as filter
		const filterText = textBefore.slice(triggerIndex + 2);
		const from = line.from + triggerIndex;

		// Don't activate if there's a closing `]]` between trigger and cursor
		if (filterText.includes(']]')) return null;

		const files = config.getFiles();
		const lowerFilter = filterText.toLowerCase();

		const options: Completion[] = files
			.filter((f) => f.name.toLowerCase().includes(lowerFilter))
			.map((f) => ({
				label: f.name,
				detail: 'file',
				apply: (view, _completion, from, to) => {
					const linkText = `[${f.name}](${makeEpicenterLink(
						config.workspaceId,
						config.tableName,
						f.id,
					)})`;
					view.dispatch({
						changes: { from, to, insert: linkText },
					});
				},
			}));

		if (options.length === 0) return null;

		return {
			from,
			to: context.pos,
			options,
			filter: false,
		};
	};
}

/**
 * Create a CodeMirror extension that provides wikilink-style autocomplete.
 *
 * When the user types `[[`, a dropdown appears with matching files from the
 * workspace. Selecting a file deletes the `[[` trigger and inserts a standard
 * markdown link `[File Name](epicenter://workspace/table/id)`.
 *
 * @example
 * ```typescript
 * import { wikilinkAutocomplete } from './extensions/wikilink-autocomplete';
 *
 * const extensions = [
 *   wikilinkAutocomplete({
 *     workspaceId: 'opensidian',
 *     tableName: 'files',
 *     getFiles: () =>
 *       workspace.tables.files
 *         .getAllValid()
 *         .filter((r) => r.type === 'file')
 *         .map((r) => ({ id: r.id, name: r.name, parentId: r.parentId })),
 *   }),
 * ];
 * ```
 */
export function wikilinkAutocomplete(config: WikilinkAutocompleteConfig) {
	return autocompletion({
		override: [wikilinkCompletionSource(config)],
	});
}
