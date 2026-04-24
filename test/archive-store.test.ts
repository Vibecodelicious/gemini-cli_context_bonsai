import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ArchiveStore,
  sanitizeFilenamePart,
  type ArchiveRecord,
} from '../src/archive-store.js';

describe('sanitizeFilenamePart', () => {
  it('keeps safe characters', () => {
    expect(sanitizeFilenamePart('abc_123-X')).toBe('abc_123-X');
  });
  it('replaces unsafe characters', () => {
    expect(sanitizeFilenamePart('a/b c:d')).toBe('a_b_c_d');
  });
  it('maps empty input to unknown', () => {
    expect(sanitizeFilenamePart('')).toBe('unknown');
  });
});

describe('ArchiveStore', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'cb-archive-'));
  });

  afterEach(() => {
    try {
      rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  function mkRecord(anchorId: string): ArchiveRecord {
    return {
      anchorId,
      rangeEndId: `${anchorId}-end`,
      summary: 'summary',
      indexTerms: ['foo'],
      createdAt: new Date(0).toISOString(),
    };
  }

  it('load returns empty archive when no file yet', async () => {
    const store = new ArchiveStore({ baseDir, sessionId: 's-1' });
    const data = await store.load();
    expect(data.archives).toEqual([]);
    expect(data.sessionId).toBe('s-1');
  });

  it('add persists and list returns records', async () => {
    const store = new ArchiveStore({ baseDir, sessionId: 's-1' });
    await store.add(mkRecord('a-1'));
    await store.add(mkRecord('a-2'));
    const list = await store.list();
    expect(list.map((r) => r.anchorId)).toEqual(['a-1', 'a-2']);
  });

  it('survives process restart (new instance loads from disk)', async () => {
    const s1 = new ArchiveStore({ baseDir, sessionId: 's-1' });
    await s1.add(mkRecord('a-1'));
    const s2 = new ArchiveStore({ baseDir, sessionId: 's-1' });
    const found = await s2.findByAnchor('a-1');
    expect(found?.anchorId).toBe('a-1');
  });

  it('removeByAnchor removes and returns the record', async () => {
    const store = new ArchiveStore({ baseDir, sessionId: 's-1' });
    await store.add(mkRecord('a-1'));
    const removed = await store.removeByAnchor('a-1');
    expect(removed?.anchorId).toBe('a-1');
    const list = await store.list();
    expect(list).toEqual([]);
  });

  it('removeByAnchor returns undefined for unknown anchor', async () => {
    const store = new ArchiveStore({ baseDir, sessionId: 's-1' });
    const removed = await store.removeByAnchor('missing');
    expect(removed).toBeUndefined();
  });

  it('sessions are keyed independently', async () => {
    const a = new ArchiveStore({ baseDir, sessionId: 'sess-A' });
    const b = new ArchiveStore({ baseDir, sessionId: 'sess-B' });
    await a.add(mkRecord('a-1'));
    expect((await b.list()).length).toBe(0);
    expect(a.getFilePath()).not.toBe(b.getFilePath());
  });

  it('sanitizes session id in file name', () => {
    const store = new ArchiveStore({
      baseDir,
      sessionId: 'weird/path:id',
    });
    expect(store.getFilePath()).toMatch(/session-weird_path_id\.json$/);
  });
});
