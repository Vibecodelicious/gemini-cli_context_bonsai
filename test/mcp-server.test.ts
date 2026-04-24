import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BONSAI_TOOLS,
  createBonsaiToolHandlers,
} from '../src/mcp-server.js';

describe('MCP server tool handlers', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'cb-mcp-'));
  });

  afterEach(() => {
    try {
      rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it('exports stable tool names', () => {
    expect(BONSAI_TOOLS.prune).toBe('context-bonsai-prune');
    expect(BONSAI_TOOLS.retrieve).toBe('context-bonsai-retrieve');
  });

  it('prune persists an archive and returns placeholder text', async () => {
    const { store, handlePrune } = createBonsaiToolHandlers({
      baseDir,
      sessionId: 'test-session',
    });

    const result = await handlePrune({
      from_pattern: 'Start of CSV discussion',
      to_pattern: 'End of CSV discussion',
      summary: 'Discussed CSV parser design; plan is finalized.',
      index_terms: ['csv', 'design'],
      anchor_id: 'msg-100',
      range_end_id: 'msg-115',
    });

    expect(result.isError).toBe(false);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Archived range msg-100 to msg-115');
    expect(text).toContain('[PRUNED: msg-100 to msg-115]');
    expect(text).toContain('Summary: Discussed CSV parser design');
    expect(text).toContain('Index: csv, design');

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.anchorId).toBe('msg-100');
  });

  it('prune rejects missing required fields deterministically', async () => {
    const { handlePrune } = createBonsaiToolHandlers({
      baseDir,
      sessionId: 'test-session',
    });

    const r1 = await handlePrune({
      from_pattern: '',
      to_pattern: 'end',
      summary: 's',
      index_terms: ['foo'],
    });
    expect(r1.isError).toBe(true);
    expect(r1.content[0]?.text).toMatch(/from_pattern/);

    const r2 = await handlePrune({
      from_pattern: 'start',
      to_pattern: 'end',
      summary: '',
      index_terms: ['foo'],
    });
    expect(r2.isError).toBe(true);
    expect(r2.content[0]?.text).toMatch(/summary/);

    const r3 = await handlePrune({
      from_pattern: 'start',
      to_pattern: 'end',
      summary: 's',
      index_terms: [],
    });
    expect(r3.isError).toBe(true);
    expect(r3.content[0]?.text).toMatch(/index_terms/);
  });

  it('prune rejects duplicate anchor', async () => {
    const { handlePrune } = createBonsaiToolHandlers({
      baseDir,
      sessionId: 'test-session',
    });

    const base = {
      from_pattern: 'a',
      to_pattern: 'b',
      summary: 's',
      index_terms: ['x'],
      anchor_id: 'same',
      range_end_id: 'end',
    };
    const first = await handlePrune(base);
    expect(first.isError).toBe(false);
    const second = await handlePrune(base);
    expect(second.isError).toBe(true);
    expect(second.content[0]?.text).toMatch(/already exists/);
  });

  it('retrieve restores and removes the archive', async () => {
    const { handlePrune, handleRetrieve } = createBonsaiToolHandlers({
      baseDir,
      sessionId: 'test-session',
    });
    await handlePrune({
      from_pattern: 'a',
      to_pattern: 'b',
      summary: 's',
      index_terms: ['x'],
      anchor_id: 'msg-7',
      range_end_id: 'msg-11',
    });

    const result = await handleRetrieve({ anchor_id: 'msg-7' });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('Restored range msg-7 to msg-11');

    const second = await handleRetrieve({ anchor_id: 'msg-7' });
    expect(second.isError).toBe(true);
  });

  it('retrieve rejects missing anchor_id', async () => {
    const { handleRetrieve } = createBonsaiToolHandlers({
      baseDir,
      sessionId: 'test-session',
    });
    const r = await handleRetrieve({});
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/anchor_id/);
  });

  it('retrieve rejects unknown anchor', async () => {
    const { handleRetrieve } = createBonsaiToolHandlers({
      baseDir,
      sessionId: 'test-session',
    });
    const r = await handleRetrieve({ anchor_id: 'unknown' });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/No archive found/);
  });

  it('same-step retrieve guard rejects when step ids match', async () => {
    let step = 's-1';
    const { handlePrune, handleRetrieve } = createBonsaiToolHandlers({
      baseDir,
      sessionId: 'test-session',
      currentStepId: () => step,
    });
    await handlePrune({
      from_pattern: 'a',
      to_pattern: 'b',
      summary: 's',
      index_terms: ['x'],
      anchor_id: 'msg-1',
      range_end_id: 'msg-2',
    });

    // Same step as the prune — should be rejected.
    const sameStep = await handleRetrieve({ anchor_id: 'msg-1' });
    expect(sameStep.isError).toBe(true);
    expect(sameStep.content[0]?.text).toMatch(/same-step|Same-step/);

    // Advancing the step id allows retrieve.
    step = 's-2';
    const nextStep = await handleRetrieve({ anchor_id: 'msg-1' });
    expect(nextStep.isError).toBe(false);
  });
});
