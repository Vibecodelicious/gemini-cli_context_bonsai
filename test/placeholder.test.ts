import { describe, it, expect } from 'vitest';

import {
  isBonsaiPlaceholder,
  renderPlaceholderText,
  type BonsaiPlaceholder,
} from '../src/placeholder.js';

describe('placeholder', () => {
  const canonical: BonsaiPlaceholder = {
    kind: 'context-bonsai-placeholder',
    anchorId: 'a-1',
    rangeEndId: 'a-9',
    summary: 'Completed the CSV pipeline design discussion.',
    indexTerms: ['csv', 'pipeline', 'design'],
  };

  describe('renderPlaceholderText', () => {
    it('renders the canonical spec format without reason', () => {
      const text = renderPlaceholderText(canonical);
      expect(text).toBe(
        [
          '[PRUNED: a-1 to a-9]',
          'Summary: Completed the CSV pipeline design discussion.',
          'Index: csv, pipeline, design',
        ].join('\n'),
      );
    });

    it('appends reason when provided', () => {
      const text = renderPlaceholderText({
        ...canonical,
        reason: 'task complete',
      });
      expect(text).toMatch(/\nReason: task complete$/);
    });

    it('omits reason when blank/whitespace', () => {
      const text = renderPlaceholderText({
        ...canonical,
        reason: '   ',
      });
      expect(text).not.toContain('Reason:');
    });
  });

  describe('isBonsaiPlaceholder', () => {
    it('accepts canonical placeholder', () => {
      expect(isBonsaiPlaceholder(canonical)).toBe(true);
    });

    it('rejects wrong kind tag', () => {
      expect(isBonsaiPlaceholder({ ...canonical, kind: 'other' })).toBe(false);
    });

    it('rejects missing required fields', () => {
      expect(isBonsaiPlaceholder({ ...canonical, anchorId: '' })).toBe(false);
      expect(isBonsaiPlaceholder({ ...canonical, rangeEndId: '' })).toBe(false);
      expect(isBonsaiPlaceholder({ ...canonical, indexTerms: 'csv' })).toBe(
        false,
      );
    });

    it('rejects non-string index term', () => {
      expect(
        isBonsaiPlaceholder({ ...canonical, indexTerms: ['csv', 42] }),
      ).toBe(false);
    });

    it('rejects non-object inputs', () => {
      expect(isBonsaiPlaceholder(null)).toBe(false);
      expect(isBonsaiPlaceholder(undefined)).toBe(false);
      expect(isBonsaiPlaceholder('string')).toBe(false);
    });

    it('rejects non-string reason', () => {
      expect(isBonsaiPlaceholder({ ...canonical, reason: 42 })).toBe(false);
    });
  });
});
