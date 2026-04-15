/**
 * YKeyValueLww Tests - Last-Write-Wins Conflict Resolution
 *
 * These tests verify timestamp-based last-write-wins semantics in `YKeyValueLww`
 * across local operations, batched transactions, and multi-client synchronization.
 * They ensure deterministic winner selection by timestamp and convergence after sync.
 *
 * Key behaviors:
 * - Higher timestamps win conflicts regardless of merge ordering.
 * - Transaction-local pending state and observer processing stay internally consistent.
 *
 * See also:
 * - `y-keyvalue.ts` for positional (rightmost-wins) alternative
 * - `y-keyvalue-comparison.test.ts` for side-by-side behavioral comparison
 */
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { YKeyValueLww, type YKeyValueLwwEntry } from './y-keyvalue-lww';

describe('YKeyValueLww', () => {
	describe('Basic Operations', () => {
		test('set stores value and get retrieves it', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
			const kv = new YKeyValueLww(yarray);

			kv.set('foo', 'bar');
			expect(kv.get('foo')).toBe('bar');
		});

		test('set overwrites existing value', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
			const kv = new YKeyValueLww(yarray);

			kv.set('foo', 'first');
			kv.set('foo', 'second');
			expect(kv.get('foo')).toBe('second');
		});

		test('bulkSet inserts all entries', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
			const kv = new YKeyValueLww(yarray);

			kv.bulkSet([
				{ key: 'foo', val: 'bar' },
				{ key: 'baz', val: 'qux' },
				{ key: 'zap', val: 'zip' },
			]);

			expect(kv.get('foo')).toBe('bar');
			expect(kv.get('baz')).toBe('qux');
			expect(kv.get('zap')).toBe('zip');
			expect(Array.from(kv.entries())).toHaveLength(3);
		});

		test('bulkSet updates existing entries', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
			const kv = new YKeyValueLww(yarray);

			kv.set('foo', 'first');
			kv.bulkSet([
				{ key: 'foo', val: 'second' },
				{ key: 'bar', val: 'third' },
			]);

			expect(kv.get('foo')).toBe('second');
			expect(kv.get('bar')).toBe('third');
			expect(
				Array.from(kv.entries())
					.map(([key]) => key)
					.sort(),
			).toEqual(['bar', 'foo']);
			expect(
				yarray
					.toArray()
					.map((entry) => entry.key)
					.sort(),
			).toEqual(['bar', 'foo']);
		});

		test('delete removes value', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
			const kv = new YKeyValueLww(yarray);

			kv.set('foo', 'bar');
			kv.delete('foo');
			expect(kv.get('foo')).toBeUndefined();
			expect(kv.has('foo')).toBe(false);
		});

		test('bulkDelete removes all specified keys', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
			const kv = new YKeyValueLww(yarray);

			kv.bulkSet([
				{ key: 'foo', val: 'bar' },
				{ key: 'baz', val: 'qux' },
				{ key: 'zap', val: 'zip' },
			]);
			kv.bulkDelete(['foo', 'zap']);

			expect(kv.get('foo')).toBeUndefined();
			expect(kv.get('zap')).toBeUndefined();
			expect(kv.get('baz')).toBe('qux');
			expect(Array.from(kv.entries()).map(([key]) => key)).toEqual(['baz']);
		});

		test('bulkDelete is a no-op for missing keys', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
			const kv = new YKeyValueLww(yarray);

			kv.bulkSet([
				{ key: 'foo', val: 'bar' },
				{ key: 'baz', val: 'qux' },
			]);
			const before = yarray.toArray();

			kv.bulkDelete(['missing', 'still-missing']);

			expect(kv.get('foo')).toBe('bar');
			expect(kv.get('baz')).toBe('qux');
			expect(yarray.toArray()).toEqual(before);
		});

		test('entries have timestamp field', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
			const kv = new YKeyValueLww(yarray);

			kv.set('foo', 'bar');

			const entry = yarray.get(0);
			expect(entry.key).toBe('foo');
			expect(entry.val).toBe('bar');
			expect(typeof entry.ts).toBe('number');
			expect(entry.ts).toBeGreaterThan(0);
		});

		test('timestamps are monotonically increasing', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
			const kv = new YKeyValueLww(yarray);

			kv.set('a', '1');
			kv.set('b', '2');
			kv.set('c', '3');

			const entries = yarray.toArray();
			const [firstEntry, secondEntry, thirdEntry] = entries;
			expect(firstEntry).toBeDefined();
			expect(secondEntry).toBeDefined();
			expect(thirdEntry).toBeDefined();
			expect(firstEntry?.ts).toBeLessThan(secondEntry?.ts);
			expect(secondEntry?.ts).toBeLessThan(thirdEntry?.ts);
		});
	});

	describe('LWW Conflict Resolution', () => {
		test('higher timestamp wins regardless of sync order', () => {
			// Create two docs that will sync
			const doc1 = new Y.Doc({ guid: 'shared' });
			const doc2 = new Y.Doc({ guid: 'shared' });

			const array1 = doc1.getArray<YKeyValueLwwEntry<string>>('data');
			const array2 = doc2.getArray<YKeyValueLwwEntry<string>>('data');

			// Manually push entries with controlled timestamps
			// Client 1 writes with LOWER timestamp (earlier)
			array1.push([{ key: 'x', val: 'from-client-1-earlier', ts: 1000 }]);

			// Client 2 writes with HIGHER timestamp (later)
			array2.push([{ key: 'x', val: 'from-client-2-later', ts: 2000 }]);

			// Sync in both directions
			Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
			Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

			// Now create KV wrappers - they should resolve conflicts
			const kv1 = new YKeyValueLww(array1);
			const kv2 = new YKeyValueLww(array2);

			// Higher timestamp should win
			expect(kv1.get('x')).toBe('from-client-2-later');
			expect(kv2.get('x')).toBe('from-client-2-later');
		});

		test('later edit wins over earlier edit (LWW semantics)', () => {
			const doc1 = new Y.Doc({ guid: 'shared' });
			const doc2 = new Y.Doc({ guid: 'shared' });

			const array1 = doc1.getArray<YKeyValueLwwEntry<string>>('data');
			const array2 = doc2.getArray<YKeyValueLwwEntry<string>>('data');

			// Manually push entries with CONTROLLED timestamps to test LWW
			// Client 1 writes with LOWER timestamp (earlier edit)
			array1.push([{ key: 'doc', val: 'edit-from-client-1', ts: 1000 }]);

			// Client 2 writes with HIGHER timestamp (later edit)
			array2.push([{ key: 'doc', val: 'edit-from-client-2', ts: 2000 }]);

			// Sync both directions
			Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
			Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

			// Create KV wrappers - they should resolve conflicts using timestamps
			const kv1 = new YKeyValueLww(array1);
			const kv2 = new YKeyValueLww(array2);

			// Higher timestamp (2000) should win
			expect(kv1.get('doc')).toBe('edit-from-client-2');
			expect(kv2.get('doc')).toBe('edit-from-client-2');
		});

		test('convergence: both clients see same value after sync', () => {
			const results: Array<{
				value: string | undefined;
				ts1: number;
				ts2: number;
			}> = [];

			for (let i = 0; i < 10; i++) {
				const doc1 = new Y.Doc({ guid: `shared-${i}` });
				const doc2 = new Y.Doc({ guid: `shared-${i}` });

				const array1 = doc1.getArray<YKeyValueLwwEntry<string>>('data');
				const array2 = doc2.getArray<YKeyValueLwwEntry<string>>('data');

				// Manually insert with controlled timestamps to test ordering
				const ts1 = 1000 + Math.random() * 1000;
				const ts2 = 1000 + Math.random() * 1000;

				array1.push([{ key: 'key', val: `client-1-${i}`, ts: ts1 }]);
				array2.push([{ key: 'key', val: `client-2-${i}`, ts: ts2 }]);

				// Sync
				Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
				Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

				// Create KV wrappers
				const kv1 = new YKeyValueLww(array1);
				const kv2 = new YKeyValueLww(array2);

				// Must converge
				expect(kv1.get('key')).toBe(kv2.get('key'));

				// Higher timestamp should win
				const expectedWinner = ts1 > ts2 ? `client-1-${i}` : `client-2-${i}`;
				expect(kv1.get('key')).toBe(expectedWinner);

				results.push({ value: kv1.get('key'), ts1, ts2 });
			}

			console.log('LWW convergence results:', results);
		});
	});

	describe('Change Events', () => {
		test('fires add event for new key', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
			const kv = new YKeyValueLww(yarray);

			const events: Array<{ key: string; action: string }> = [];
			kv.observe((changes) => {
				for (const [key, change] of changes) {
					events.push({ key, action: change.action });
				}
			});

			kv.set('foo', 'bar');
			expect(events).toEqual([{ key: 'foo', action: 'add' }]);
		});

		test('fires update event when value changes', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
			const kv = new YKeyValueLww(yarray);

			kv.set('foo', 'first');

			const events: Array<{ key: string; action: string }> = [];
			kv.observe((changes) => {
				for (const [key, change] of changes) {
					events.push({ key, action: change.action });
				}
			});

			kv.set('foo', 'second');
			expect(events).toEqual([{ key: 'foo', action: 'update' }]);
		});

		test('fires delete event when key removed', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
			const kv = new YKeyValueLww(yarray);

			kv.set('foo', 'bar');

			const events: Array<{ key: string; action: string }> = [];
			kv.observe((changes) => {
				for (const [key, change] of changes) {
					events.push({ key, action: change.action });
				}
			});

			kv.delete('foo');
			expect(events).toEqual([{ key: 'foo', action: 'delete' }]);
		});
	});

	describe('Equal Timestamp Tiebreaker', () => {
		test('equal timestamps fall back to positional ordering (rightmost wins)', () => {
			const ydoc = new Y.Doc({ guid: 'test' });
			const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');

			// Push two entries with same timestamp
			yarray.push([{ key: 'x', val: 'first', ts: 1000 }]);
			yarray.push([{ key: 'x', val: 'second', ts: 1000 }]); // same ts, but rightmost

			const kv = new YKeyValueLww(yarray);

			// Rightmost should win when timestamps equal
			expect(kv.get('x')).toBe('second');
			expect(yarray.length).toBe(1); // Duplicate should be cleaned up
		});
	});

	describe('Single-Writer Architecture', () => {
		/**
		 * These tests verify the single-writer architecture where:
		 * - set() writes to `pending` and Y.Array, but NOT to `map`
		 * - Observer is the sole writer to `map` and clears `pending` after processing
		 * - get()/has() check `pending` first, then `map`
		 * - entries() yields from both pending and map
		 */

		describe('Batch operations with nested reads', () => {
			test('get() returns value set in same batch', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				let valueInBatch: string | undefined;

				ydoc.transact(() => {
					kv.set('foo', 'bar');
					valueInBatch = kv.get('foo');
				});

				expect(valueInBatch).toBe('bar');
				expect(kv.get('foo')).toBe('bar'); // Still works after batch
			});

			test('has() returns true for key set in same batch', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				let hasInBatch: boolean = false;

				ydoc.transact(() => {
					kv.set('foo', 'bar');
					hasInBatch = kv.has('foo');
				});

				expect(hasInBatch).toBe(true);
			});

			test('multiple updates to same key in batch - final value wins', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				const valuesInBatch: Array<string | undefined> = [];

				ydoc.transact(() => {
					kv.set('foo', 'first');
					valuesInBatch.push(kv.get('foo'));

					kv.set('foo', 'second');
					valuesInBatch.push(kv.get('foo'));

					kv.set('foo', 'third');
					valuesInBatch.push(kv.get('foo'));
				});

				expect(valuesInBatch).toEqual(['first', 'second', 'third']);
				expect(kv.get('foo')).toBe('third');
			});

			test('get() returns updated value when updating existing key in batch', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				// Set initial value outside batch
				kv.set('foo', 'initial');

				let valueInBatch: string | undefined;

				ydoc.transact(() => {
					kv.set('foo', 'updated');
					valueInBatch = kv.get('foo');
				});

				expect(valueInBatch).toBe('updated');
				expect(kv.get('foo')).toBe('updated');
			});
		});

		describe('Batch with deletes', () => {
			test('delete() removes key set in same batch', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				let hasAfterDelete: boolean = true;

				ydoc.transact(() => {
					kv.set('foo', 'bar');
					kv.delete('foo');
					hasAfterDelete = kv.has('foo');
				});

				// During batch: pending was cleared by delete(), map doesn't have it yet
				expect(hasAfterDelete).toBe(false);

				// After batch: delete() now correctly removes the yarray entry even for
				// keys that were set (pending-only) in the same transaction
				expect(kv.has('foo')).toBe(false);
			});

			test('set() after delete() in same batch restores key', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				// Set initial value
				kv.set('foo', 'initial');

				let valueInBatch: string | undefined;

				ydoc.transact(() => {
					kv.delete('foo');
					kv.set('foo', 'restored');
					valueInBatch = kv.get('foo');
				});

				expect(valueInBatch).toBe('restored');
				expect(kv.get('foo')).toBe('restored');
			});

			test('delete() on pre-existing key during batch', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('foo', 'bar');
				expect(kv.has('foo')).toBe(true);

				ydoc.transact(() => {
					kv.delete('foo');
					// During batch, map still has old value until observer fires
					// But has() checks pending first (which was cleared)
				});

				expect(kv.has('foo')).toBe(false);
			});
		});

		describe('entries() iterator', () => {
			test('entries() yields pending values during batch', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				const keysInBatch: string[] = [];

				ydoc.transact(() => {
					kv.set('a', '1');
					kv.set('b', '2');
					kv.set('c', '3');

					for (const [key] of kv.entries()) {
						keysInBatch.push(key);
					}
				});

				expect(keysInBatch.sort()).toEqual(['a', 'b', 'c']);
			});

			test('entries() yields both pending and map values', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				// Set initial values (will be in map after transaction)
				kv.set('existing', 'old');

				const entriesInBatch: Array<[string, string]> = [];

				ydoc.transact(() => {
					kv.set('new', 'value');

					for (const [key, entry] of kv.entries()) {
						entriesInBatch.push([key, entry.val]);
					}
				});

				expect(entriesInBatch).toContainEqual(['existing', 'old']);
				expect(entriesInBatch).toContainEqual(['new', 'value']);
			});

			test('entries() prefers pending over map for same key', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('foo', 'old');

				let valueInBatch: string | undefined;

				ydoc.transact(() => {
					kv.set('foo', 'new');

					for (const [key, entry] of kv.entries()) {
						if (key === 'foo') valueInBatch = entry.val;
					}
				});

				expect(valueInBatch).toBe('new');
			});

			test('entries() does not yield duplicates', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('foo', 'old');

				let fooCount = 0;

				ydoc.transact(() => {
					kv.set('foo', 'new');

					for (const [key] of kv.entries()) {
						if (key === 'foo') fooCount++;
					}
				});

				expect(fooCount).toBe(1);
			});
		});

		describe('Pending cleanup', () => {
			test('pending is cleared after transaction ends', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				ydoc.transact(() => {
					kv.set('foo', 'bar');
					// During transaction, foo is in pending
				});

				// After transaction, observer has fired and cleared pending
				// We can't directly access pending, but we can verify behavior
				// by checking that map has the value
				expect(kv.get('foo')).toBe('bar');
				expect(kv.map.has('foo')).toBe(true);
			});

			test('multiple transactions preserve prior keys and apply updates', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				ydoc.transact(() => {
					kv.set('a', '1');
					kv.set('b', '2');
				});

				expect(kv.get('a')).toBe('1');
				expect(kv.get('b')).toBe('2');

				ydoc.transact(() => {
					kv.set('c', '3');
					kv.set('a', 'updated');
				});

				expect(kv.get('a')).toBe('updated');
				expect(kv.get('b')).toBe('2');
				expect(kv.get('c')).toBe('3');
			});
		});

		describe('Observer behavior', () => {
			test('observer fires once per batch, not per set()', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				let observerCallCount = 0;
				kv.observe(() => {
					observerCallCount++;
				});

				ydoc.transact(() => {
					kv.set('a', '1');
					kv.set('b', '2');
					kv.set('c', '3');
				});

				expect(observerCallCount).toBe(1);
			});

			test('observer receives all changes from batch', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				const changedKeys: string[] = [];
				kv.observe((changes) => {
					for (const [key] of changes) {
						changedKeys.push(key);
					}
				});

				ydoc.transact(() => {
					kv.set('a', '1');
					kv.set('b', '2');
					kv.set('c', '3');
				});

				expect(changedKeys.sort()).toEqual(['a', 'b', 'c']);
			});
		});

		describe('Sync with pending values', () => {
			test('remote sync during batch: synced values visible after batch ends', () => {
				const doc1 = new Y.Doc({ guid: 'shared' });
				const doc2 = new Y.Doc({ guid: 'shared' });

				const array1 = doc1.getArray<YKeyValueLwwEntry<string>>('data');
				const array2 = doc2.getArray<YKeyValueLwwEntry<string>>('data');

				const kv1 = new YKeyValueLww(array1);
				const kv2 = new YKeyValueLww(array2);

				// kv1 sets a value
				kv1.set('foo', 'from-kv1');

				// kv2 makes a change while kv1's change is not yet synced
				doc2.transact(() => {
					kv2.set('bar', 'from-kv2');
					// Sync kv1's changes into kv2 during the batch
					Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

					// During batch: local pending values are visible
					expect(kv2.get('bar')).toBe('from-kv2');
					// Remote synced values are in yarray but observer hasn't updated map yet
					// So they won't be visible via get() until batch ends
				});

				// After batch: both local and synced values are visible
				expect(kv2.get('bar')).toBe('from-kv2');
				expect(kv2.get('foo')).toBe('from-kv1');
			});

			test('LWW still works with pending entries', () => {
				const doc1 = new Y.Doc({ guid: 'shared' });
				const doc2 = new Y.Doc({ guid: 'shared' });

				const array1 = doc1.getArray<YKeyValueLwwEntry<string>>('data');
				const array2 = doc2.getArray<YKeyValueLwwEntry<string>>('data');

				// Manually insert with controlled timestamps
				array1.push([{ key: 'x', val: 'old', ts: 1000 }]);

				const kv1 = new YKeyValueLww(array1);
				const kv2 = new YKeyValueLww(array2);

				// Sync initial state
				Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
				expect(kv2.get('x')).toBe('old');

				// kv2 updates with higher timestamp
				kv2.set('x', 'new'); // Will get ts > 1000

				// Sync both ways
				Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));
				Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

				// Higher timestamp should win
				expect(kv1.get('x')).toBe('new');
				expect(kv2.get('x')).toBe('new');
			});
		});

		describe('Edge cases', () => {
			test('set() with undefined value', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray =
					ydoc.getArray<YKeyValueLwwEntry<string | undefined>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('foo', undefined);
				expect(kv.has('foo')).toBe(true);
				expect(kv.get('foo')).toBeUndefined();
			});

			test('rapid set/get cycles always return the latest value', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<number>>('data');
				const kv = new YKeyValueLww(yarray);

				for (let i = 0; i < 100; i++) {
					kv.set('counter', i);
					expect(kv.get('counter')).toBe(i);
				}

				expect(kv.get('counter')).toBe(99);
			});

			test('batch with mixed operations on multiple keys', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				// Pre-populate
				kv.set('keep', 'original');
				kv.set('update', 'old');
				kv.set('delete', 'gone');

				ydoc.transact(() => {
					kv.set('new', 'added');
					kv.set('update', 'new');
					kv.delete('delete');

					expect(kv.get('keep')).toBe('original');
					expect(kv.get('update')).toBe('new');
					expect(kv.get('new')).toBe('added');
					// delete() adds key to pendingDeletes, so has() returns false immediately
					expect(kv.has('delete')).toBe(false);
					expect(kv.get('delete')).toBeUndefined();
				});

				expect(kv.get('keep')).toBe('original');
				expect(kv.get('update')).toBe('new');
				expect(kv.get('new')).toBe('added');
				expect(kv.has('delete')).toBe(false);
			});

			test('delete during batch: has() returns false immediately', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('foo', 'bar');

				let hasDuringBatch: boolean = true;

				ydoc.transact(() => {
					kv.delete('foo');
					hasDuringBatch = kv.has('foo');
				});

				// During batch, has() correctly returns false via pendingDeletes
				expect(hasDuringBatch).toBe(false);
				// After batch, still correctly returns false
				expect(kv.has('foo')).toBe(false);
			});

			test('delete then get in batch returns undefined', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('foo', 'bar');

				let getDuringBatch: string | undefined = 'not-cleared';

				ydoc.transact(() => {
					kv.delete('foo');
					getDuringBatch = kv.get('foo');
				});

				expect(getDuringBatch).toBeUndefined();
				expect(kv.get('foo')).toBeUndefined();
			});

			test('delete then set in batch returns new value', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('foo', 'bar');

				let getDuringBatch: string | undefined;

				ydoc.transact(() => {
					kv.delete('foo');
					expect(kv.get('foo')).toBeUndefined();
					kv.set('foo', 'new');
					getDuringBatch = kv.get('foo');
				});

				expect(getDuringBatch).toBe('new');
				expect(kv.get('foo')).toBe('new');
				expect(kv.has('foo')).toBe(true);
			});

			test('double delete is idempotent', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('foo', 'bar');

				ydoc.transact(() => {
					kv.delete('foo');
					kv.delete('foo'); // second delete should be no-op
					expect(kv.has('foo')).toBe(false);
				});

				expect(kv.has('foo')).toBe(false);
				expect(kv.get('foo')).toBeUndefined();
			});

			test('entries skips pending deletes', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('a', '1');
				kv.set('b', '2');
				kv.set('c', '3');

				let keysDuringBatch: string[] = [];

				ydoc.transact(() => {
					kv.delete('b');
					keysDuringBatch = Array.from(kv.entries()).map(([key]) => key);
				});

				expect(keysDuringBatch).not.toContain('b');
				expect(keysDuringBatch).toContain('a');
				expect(keysDuringBatch).toContain('c');
			});

			test('observer clears pendingDeletes', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('foo', 'bar');

				ydoc.transact(() => {
					kv.delete('foo');
					expect(kv.has('foo')).toBe(false); // pendingDeletes active
				});

				// After transaction, observer has fired and cleared pendingDeletes
				// Verify by setting a new value — if pendingDeletes wasn't cleared,
				// has() would still return false incorrectly
				kv.set('foo', 'baz');
				expect(kv.has('foo')).toBe(true);
				expect(kv.get('foo')).toBe('baz');
			});

			test('set+delete in same batch leaves no sticky pendingDeletes', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				// set then delete in same batch — entry added+deleted from yarray
				ydoc.transact(() => {
					kv.set('foo', 'bar');
					kv.delete('foo');
				});

				// After transaction, pendingDeletes should be clear (observer processed deletion)
				// Verify: a subsequent set should work correctly
				kv.set('foo', 'new');
				expect(kv.has('foo')).toBe(true);
				expect(kv.get('foo')).toBe('new');
			});

			test('remote set after local delete is not masked by pendingDeletes', () => {
				const ydoc1 = new Y.Doc({ guid: 'test' });
				const yarray1 = ydoc1.getArray<YKeyValueLwwEntry<string>>('data');
				const kv1 = new YKeyValueLww(yarray1);

				const ydoc2 = new Y.Doc({ guid: 'test' });
				const yarray2 = ydoc2.getArray<YKeyValueLwwEntry<string>>('data');
				const kv2 = new YKeyValueLww(yarray2);

				// Both clients have the key
				kv1.set('foo', 'original');
				Y.applyUpdate(ydoc2, Y.encodeStateAsUpdate(ydoc1));

				// Client 1 deletes
				kv1.delete('foo');
				expect(kv1.has('foo')).toBe(false);

				// Client 2 sets a new value (higher timestamp)
				kv2.set('foo', 'remote-value');

				// Sync client 2's update to client 1
				Y.applyUpdate(ydoc1, Y.encodeStateAsUpdate(ydoc2));

				// Client 1 should see the remote value — pendingDeletes must not mask it
				expect(kv1.has('foo')).toBe(true);
				expect(kv1.get('foo')).toBe('remote-value');
			});

			test('set→delete→set triple sequence in batch', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('foo', 'initial');

				let finalGet: string | undefined;

				ydoc.transact(() => {
					kv.set('foo', 'first');
					kv.delete('foo');
					expect(kv.get('foo')).toBeUndefined();
					kv.set('foo', 'final');
					finalGet = kv.get('foo');
				});

				expect(finalGet).toBe('final');
				expect(kv.get('foo')).toBe('final');
				expect(kv.has('foo')).toBe(true);
			});

			test('delete→set→delete triple sequence in batch', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('foo', 'original');

				ydoc.transact(() => {
					kv.delete('foo');
					expect(kv.has('foo')).toBe(false);
					kv.set('foo', 'revived');
					expect(kv.get('foo')).toBe('revived');
					kv.delete('foo');
					expect(kv.has('foo')).toBe(false);
				});

				expect(kv.has('foo')).toBe(false);
				expect(kv.get('foo')).toBeUndefined();
			});

			test('set→set→delete triple sequence in batch: second set survives', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				ydoc.transact(() => {
					kv.set('foo', 'first');
					kv.set('foo', 'second');
					expect(kv.get('foo')).toBe('second');
					kv.delete('foo');
					// During batch, pendingDeletes blocks reads
					expect(kv.has('foo')).toBe(false);
				});

				// After batch: two set() calls in same batch push two entries to yarray.
				// delete() only removes the first matching entry via findIndex().
				// The second entry survives, and the observer processes it as an add.
				// This is a known edge case — the second set's entry "wins".
				expect(kv.has('foo')).toBe(true);
				expect(kv.get('foo')).toBe('second');
			});

			test('delete non-existent key is no-op', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				// Delete a key that was never set — should not throw
				kv.delete('never-existed');
				expect(kv.has('never-existed')).toBe(false);
				expect(kv.get('never-existed')).toBeUndefined();

				// Also test inside a batch
				ydoc.transact(() => {
					kv.delete('also-never-existed');
					expect(kv.has('also-never-existed')).toBe(false);
				});
			});

			test('pendingDeletes beats pending: set then delete in batch', () => {
				const ydoc = new Y.Doc({ guid: 'test' });
				const yarray = ydoc.getArray<YKeyValueLwwEntry<string>>('data');
				const kv = new YKeyValueLww(yarray);

				kv.set('foo', 'original');

				let getDuringBatch: string | undefined = 'sentinel';

				ydoc.transact(() => {
					// set() adds to pending, clears pendingDeletes
					kv.set('foo', 'updated');
					expect(kv.get('foo')).toBe('updated');

					// delete() clears pending, adds to pendingDeletes
					kv.delete('foo');
					getDuringBatch = kv.get('foo');
				});

				// During batch, pendingDeletes should have taken precedence
				expect(getDuringBatch).toBeUndefined();
				expect(kv.has('foo')).toBe(false);
			});

			test('remote add for different key does not clear unrelated pendingDeletes', () => {
				const ydoc1 = new Y.Doc({ guid: 'test' });
				const yarray1 = ydoc1.getArray<YKeyValueLwwEntry<string>>('data');
				const kv1 = new YKeyValueLww(yarray1);

				const ydoc2 = new Y.Doc({ guid: 'test' });
				const yarray2 = ydoc2.getArray<YKeyValueLwwEntry<string>>('data');
				const kv2 = new YKeyValueLww(yarray2);

				// Both clients have keys 'a' and 'b'
				kv1.set('a', '1');
				kv1.set('b', '2');
				Y.applyUpdate(ydoc2, Y.encodeStateAsUpdate(ydoc1));

				// Client 1 deletes 'a'
				kv1.delete('a');
				expect(kv1.has('a')).toBe(false);

				// Client 2 adds a completely new key 'c'
				kv2.set('c', '3');

				// Sync client 2's update to client 1
				Y.applyUpdate(ydoc1, Y.encodeStateAsUpdate(ydoc2));

				// 'a' should still be deleted — the remote add of 'c' should not affect it
				expect(kv1.has('a')).toBe(false);
				expect(kv1.get('a')).toBeUndefined();
				// 'c' should be visible
				expect(kv1.get('c')).toBe('3');
			});

			test('both clients delete same key', () => {
				const ydoc1 = new Y.Doc({ guid: 'test' });
				const yarray1 = ydoc1.getArray<YKeyValueLwwEntry<string>>('data');
				const kv1 = new YKeyValueLww(yarray1);

				const ydoc2 = new Y.Doc({ guid: 'test' });
				const yarray2 = ydoc2.getArray<YKeyValueLwwEntry<string>>('data');
				const kv2 = new YKeyValueLww(yarray2);

				// Both clients have the key
				kv1.set('foo', 'shared');
				Y.applyUpdate(ydoc2, Y.encodeStateAsUpdate(ydoc1));
				expect(kv2.get('foo')).toBe('shared');

				// Both delete independently
				kv1.delete('foo');
				kv2.delete('foo');

				// Sync both ways
				Y.applyUpdate(ydoc2, Y.encodeStateAsUpdate(ydoc1));
				Y.applyUpdate(ydoc1, Y.encodeStateAsUpdate(ydoc2));

				// Both should see it deleted
				expect(kv1.has('foo')).toBe(false);
				expect(kv2.has('foo')).toBe(false);
			});

			test('local set then remote delete of same key', () => {
				const ydoc1 = new Y.Doc({ guid: 'test' });
				const yarray1 = ydoc1.getArray<YKeyValueLwwEntry<string>>('data');
				const kv1 = new YKeyValueLww(yarray1);

				const ydoc2 = new Y.Doc({ guid: 'test' });
				const yarray2 = ydoc2.getArray<YKeyValueLwwEntry<string>>('data');
				const kv2 = new YKeyValueLww(yarray2);

				// Both clients have the key
				kv1.set('foo', 'original');
				Y.applyUpdate(ydoc2, Y.encodeStateAsUpdate(ydoc1));

				// Client 1 updates the key (gets higher timestamp)
				kv1.set('foo', 'updated');

				// Client 2 deletes the key
				kv2.delete('foo');

				// Sync both ways
				Y.applyUpdate(ydoc2, Y.encodeStateAsUpdate(ydoc1));
				Y.applyUpdate(ydoc1, Y.encodeStateAsUpdate(ydoc2));

				// Client 1's set had a higher timestamp, so it should win over client 2's delete.
				// After sync, both should converge to the same value.
				expect(kv1.get('foo')).toBe(kv2.get('foo'));
				// The set (with higher ts) wins over the delete
				expect(kv1.get('foo')).toBe('updated');
			});
		});
	});
});
