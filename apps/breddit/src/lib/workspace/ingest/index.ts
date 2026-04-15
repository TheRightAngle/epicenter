/**
 * Ingest module for importing external data exports.
 *
 * Currently supports:
 * - Reddit GDPR exports
 *
 * @packageDocumentation
 */

// Reddit importer
export {
	type ImportError,
	type ImportProgress,
	type ImportStats,
	importRedditExport,
	previewRedditExport,
	type RedditWorkspace,
	redditWorkspace,
} from './reddit/index.js';
// Utilities (for custom importers)
export { CSV, type CsvOptions, parseCsv } from './utils/csv.js';
