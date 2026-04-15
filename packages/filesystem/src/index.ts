// Errors
export { FS_ERRORS, type FsErrorCode } from './errors.js';
// Extensions
export {
	createSqliteIndex,
	type SearchResult,
	type SqliteIndex,
	type SqliteIndexOptions,
} from './extensions/sqlite-index/index.js';
// File system (orchestrator)
export { createYjsFileSystem, type YjsFileSystem } from './file-system.js';
// Formats
export {
	markdownSchema,
	parseFrontmatter,
	reorderColumn,
	reorderRow,
	serializeMarkdownWithFrontmatter,
	serializeXmlFragmentToMarkdown,
	updateYMapFromRecord,
	updateYXmlFragmentFromString,
	yMapToRecord,
} from './formats/index.js';
// IDs
export type { ColumnId, FileId, RowId } from './ids.js';
export { generateColumnId, generateFileId, generateRowId } from './ids.js';
// Path utilities
export { posixResolve } from './path.js';
// Table
export { type ColumnDefinition, type FileRow, filesTable } from './table.js';
// Tree (metadata layer)
export {
	assertUniqueName,
	createFileSystemIndex,
	createFileTree,
	disambiguateNames,
	type FileSystemIndex,
	type FileTree,
	validateName,
} from './tree/index.js';
