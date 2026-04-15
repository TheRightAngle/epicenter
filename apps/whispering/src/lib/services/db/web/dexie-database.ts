import Dexie, { type Transaction } from 'dexie';
import { extractErrorMessage } from 'wellcrafted/error';
import { moreDetailsDialog } from '$lib/components/MoreDetailsDialog.svelte';
import { rpc } from '$lib/query';
import type { DownloadService } from '$lib/services/download';

import type {
	TransformationStepV2,
	TransformationV1,
	TransformationV2,
} from '../models';
import type {
	RecordingsDbSchemaV1,
	RecordingsDbSchemaV2,
	RecordingsDbSchemaV3,
	RecordingsDbSchemaV4,
	RecordingsDbSchemaV5,
	SerializedAudio,
} from './dexie-schemas';

const DB_NAME = 'RecordingDB';

/**
 * Convert Blob to serialized format for IndexedDB storage.
 * Returns undefined if conversion fails.
 */
export async function blobToSerializedAudio(
	blob: Blob,
): Promise<SerializedAudio | undefined> {
	const arrayBuffer = await blob.arrayBuffer().catch((error) => {
		console.error('Error getting array buffer from blob', blob, error);
		return undefined;
	});

	if (!arrayBuffer) return undefined;

	return { arrayBuffer, blobType: blob.type };
}

export class WhisperingDatabase extends Dexie {
	recordings!: Dexie.Table<RecordingsDbSchemaV5['recordings'], string>;
	transformations!: Dexie.Table<TransformationV2, string>;
	transformationRuns!: Dexie.Table<
		import('../models').TransformationRun,
		string
	>;

	constructor({ DownloadService }: { DownloadService: DownloadService }) {
		super(DB_NAME);

		const wrapUpgradeWithErrorHandling = async ({
			tx,
			version,
			upgrade,
		}: {
			tx: Transaction;
			version: number;
			upgrade: (tx: Transaction) => Promise<void>;
		}) => {
			try {
				await upgrade(tx);
			} catch (error) {
				const DUMP_TABLE_NAMES = [
					'recordings',
					'recordingMetadata',
					'recordingBlobs',
				] as const;

				const dumpTable = async (tableName: string) => {
					try {
						const contents = await tx.table(tableName).toArray();
						return contents;
					} catch (_error) {
						return [];
					}
				};

				const dumps = await Dexie.waitFor(
					Promise.all(DUMP_TABLE_NAMES.map((name) => dumpTable(name))),
				);

				const dumpState = {
					version,
					tables: Object.fromEntries(
						DUMP_TABLE_NAMES.map((name, i) => [name, dumps[i]]),
					),
				};

				const dumpString = JSON.stringify(dumpState, null, 2);

				moreDetailsDialog.open({
					title: `Failed to upgrade IndexedDb Database to version ${version}`,
					description:
						'Please download the database dump and delete the database to start fresh.',
					content: dumpString,
					buttons: [
						{
							label: 'Download Database Dump',
							onClick: async () => {
								const blob = new Blob([dumpString], {
									type: 'application/json',
								});
								const { error: downloadError } =
									await DownloadService.downloadBlob({
										name: 'recording-db-dump.json',
										blob,
									});
								if (downloadError) {
									rpc.notify.error({
										title: 'Failed to download IndexedDB dump!',
										description: 'Your IndexedDB dump could not be downloaded.',
										action: { type: 'more-details', error: downloadError },
									});
								} else {
									rpc.notify.success({
										title: 'IndexedDB dump downloaded!',
										description: 'Your IndexedDB dump is being downloaded.',
									});
								}
							},
						},
						{
							label: 'Delete Database and Reload',
							variant: 'destructive',
							onClick: async () => {
								try {
									// Delete the database
									await this.delete();
									rpc.notify.success({
										title: 'Database Deleted',
										description:
											'The database has been successfully deleted. Please refresh the page.',
										action: {
											type: 'button',
											label: 'Refresh',
											onClick: () => {
												window.location.reload();
											},
										},
									});
								} catch (err) {
									const error = extractErrorMessage(err);

									rpc.notify.error({
										title: 'Failed to Delete Database',
										description:
											'There was an error deleting the database. Please try again.',
										action: {
											type: 'more-details',
											error,
										},
									});
								}
							},
						},
					],
				});

				throw error; // Re-throw to trigger rollback
			}
		};

		// V1: Single recordings table
		this.version(0.1).stores({ recordings: '&id, timestamp' });

		// V2: Split into metadata and blobs
		this.version(0.2)
			.stores({
				recordings: null,
				recordingMetadata: '&id',
				recordingBlobs: '&id',
			})
			.upgrade(async (tx) => {
				await wrapUpgradeWithErrorHandling({
					tx,
					version: 0.2,
					upgrade: async (tx) => {
						// Migrate data from recordings to split tables
						const oldRecordings = await tx
							.table<RecordingsDbSchemaV1['recordings']>('recordings')
							.toArray();

						// Create entries in both new tables
						const metadata = oldRecordings.map(
							({ blob, ...recording }) => recording,
						);
						const blobs = oldRecordings.map(({ id, blob }) => ({ id, blob }));

						await tx
							.table<RecordingsDbSchemaV2['recordingMetadata']>(
								'recordingMetadata',
							)
							.bulkAdd(metadata);
						await tx
							.table<RecordingsDbSchemaV2['recordingBlobs']>('recordingBlobs')
							.bulkAdd(blobs);
					},
				});
			});

		// V3: Back to single recordings table
		this.version(0.3)
			.stores({
				recordings: '&id, timestamp',
				recordingMetadata: null,
				recordingBlobs: null,
			})
			.upgrade(async (tx) => {
				await wrapUpgradeWithErrorHandling({
					tx,
					version: 0.3,
					upgrade: async (tx) => {
						// Get data from both tables
						const metadata = await tx
							.table<RecordingsDbSchemaV2['recordingMetadata']>(
								'recordingMetadata',
							)
							.toArray();
						const blobs = await tx
							.table<RecordingsDbSchemaV2['recordingBlobs']>('recordingBlobs')
							.toArray();

						// Combine and migrate the data
						const mergedRecordings = metadata.map((record) => {
							const blob = blobs.find((b) => b.id === record.id)?.blob;
							return { ...record, blob };
						});

						await tx
							.table<RecordingsDbSchemaV3['recordings']>('recordings')
							.bulkAdd(mergedRecordings);
					},
				});
			});

		// V4: Add transformations, transformation runs, and recording
		// Also migrate recordings timestamp to createdAt and updatedAt
		this.version(0.4)
			.stores({
				recordings: '&id, timestamp, createdAt, updatedAt',
				transformations: '&id, createdAt, updatedAt',
				transformationRuns: '&id, transformationId, recordingId, startedAt',
			})
			.upgrade(async (tx) => {
				await wrapUpgradeWithErrorHandling({
					tx,
					version: 0.4,
					upgrade: async (tx) => {
						const oldRecordings = await tx
							.table<RecordingsDbSchemaV3['recordings']>('recordings')
							.toArray();

						const newRecordings = oldRecordings.map(
							(record) =>
								({
									...record,
									createdAt: record.timestamp,
									updatedAt: record.timestamp,
								}) satisfies RecordingsDbSchemaV4['recordings'],
						);

						await tx.table('recordings').clear();
						await tx
							.table<RecordingsDbSchemaV4['recordings']>('recordings')
							.bulkAdd(newRecordings);
					},
				});
			});

		// V5: Save recording blob as ArrayBuffer
		this.version(0.5)
			.stores({
				recordings: '&id, timestamp, createdAt, updatedAt',
				transformations: '&id, createdAt, updatedAt',
				transformationRuns: '&id, transformationId, recordingId, startedAt',
			})
			.upgrade(async (tx) => {
				await wrapUpgradeWithErrorHandling({
					tx,
					version: 0.5,
					upgrade: async (tx) => {
						const oldRecordings = await tx
							.table<RecordingsDbSchemaV4['recordings']>('recordings')
							.toArray();

						const newRecordings = await Dexie.waitFor(
							Promise.all(
								oldRecordings.map(async (record) => {
									// Convert V4 (Recording with blob) to V5 (RecordingStoredInIndexedDB)
									const { blob, ...recordWithoutBlob } = record;
									const serializedAudio = blob
										? await blobToSerializedAudio(blob)
										: undefined;
									return {
										...recordWithoutBlob,
										serializedAudio,
									} satisfies RecordingsDbSchemaV5['recordings'];
								}),
							),
						);

						await Dexie.waitFor(tx.table('recordings').clear());
						await Dexie.waitFor(
							tx
								.table<RecordingsDbSchemaV5['recordings']>('recordings')
								.bulkAdd(newRecordings),
						);
					},
				});
			});

		// V6: Migrate transformation steps to version 2 schema
		// - Adds version field (set to 2)
		// - Adds Custom.model and Custom.baseUrl fields for local LLM endpoints
		// This matches the versioned schema in transformations.ts
		//
		// Note: TransformationV1 is a TypeScript type hint only; Dexie returns raw data.
		// Old steps in IndexedDB won't have a `version` field at all. The spread `...step`
		// preserves all existing fields, then we explicitly set version=2 and the new
		// Custom fields. Any existing `version` field (if somehow present) gets overwritten
		// to 2, which is correct since we're migrating everything to V2.
		this.version(0.6)
			.stores({
				recordings: '&id, timestamp, createdAt, updatedAt',
				transformations: '&id, createdAt, updatedAt',
				transformationRuns: '&id, transformationId, recordingId, startedAt',
			})
			.upgrade(async (tx) => {
				await wrapUpgradeWithErrorHandling({
					tx,
					version: 0.6,
					upgrade: async (tx) => {
						// TransformationV1 is just a type hint; Dexie returns raw unvalidated data
						const transformations = await tx
							.table<TransformationV1>('transformations')
							.toArray();

						for (const transformation of transformations) {
							const updatedSteps: TransformationStepV2[] =
								transformation.steps.map((step) => ({
									...step,
									// Explicitly set V2 fields (overwrites any existing values)
									version: 2 as const,
									'prompt_transform.inference.provider.Custom.model': '',
									'prompt_transform.inference.provider.Custom.baseUrl': '',
								}));

							await tx
								.table<TransformationV2>('transformations')
								.update(transformation.id, { steps: updatedSteps });
						}
					},
				});
			});
	}
}
