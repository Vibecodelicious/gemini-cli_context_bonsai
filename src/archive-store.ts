/**
 * Sidecar archive persistence for Context Bonsai on Gemini CLI.
 *
 * Archive state is written to `<baseDir>/context-bonsai/session-<sessionId>.json`,
 * where `<baseDir>` is the host-provided temp dir (e.g. `storage.getProjectTempDir()`).
 *
 * The store is deliberately JSON-on-disk: small, easy to inspect, easy to
 * recover from, and survives process restarts. Reads are tolerant of missing
 * files (empty archive). Writes are atomic via tmp + rename.
 */

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * One archived range.
 */
export interface ArchiveRecord {
  readonly anchorId: string;
  readonly rangeEndId: string;
  readonly summary: string;
  readonly indexTerms: readonly string[];
  readonly reason?: string;
  /** ISO timestamp when the archive was created. */
  readonly createdAt: string;
  /** Optional per-step id used by the same-step retrieve guard. */
  readonly stepId?: string;
}

export interface ArchiveFile {
  readonly version: 1;
  readonly sessionId: string;
  readonly archives: readonly ArchiveRecord[];
}

export interface ArchiveStoreOptions {
  readonly baseDir: string;
  readonly sessionId: string;
}

/**
 * Sanitize a component of the session file name.
 *
 * Mirrors the conservative approach used elsewhere in the project: only
 * alphanumerics, dash, and underscore are preserved. Empty input is mapped to
 * the literal "unknown" to keep the file path stable.
 */
export function sanitizeFilenamePart(s: string): string {
  if (!s) return 'unknown';
  return s.replace(/[^A-Za-z0-9_-]/g, '_');
}

export class ArchiveStore {
  private readonly file: string;
  private readonly sessionId: string;
  private cache: ArchiveFile | undefined;

  constructor(opts: ArchiveStoreOptions) {
    this.sessionId = opts.sessionId;
    const safe = sanitizeFilenamePart(opts.sessionId);
    this.file = join(opts.baseDir, 'context-bonsai', `session-${safe}.json`);
  }

  /**
   * Absolute path to the sidecar JSON file for this session.
   */
  getFilePath(): string {
    return this.file;
  }

  async load(): Promise<ArchiveFile> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as ArchiveFile;
      if (
        !parsed ||
        parsed.version !== 1 ||
        typeof parsed.sessionId !== 'string' ||
        !Array.isArray(parsed.archives)
      ) {
        // Unknown / corrupt shape: start fresh rather than bubbling mid-read.
        this.cache = {
          version: 1,
          sessionId: this.sessionId,
          archives: [],
        };
        return this.cache;
      }
      this.cache = parsed;
      return parsed;
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr && nodeErr.code === 'ENOENT') {
        this.cache = {
          version: 1,
          sessionId: this.sessionId,
          archives: [],
        };
        return this.cache;
      }
      throw err;
    }
  }

  async list(): Promise<readonly ArchiveRecord[]> {
    const data = await this.load();
    return data.archives;
  }

  async findByAnchor(anchorId: string): Promise<ArchiveRecord | undefined> {
    const data = await this.load();
    return data.archives.find((a) => a.anchorId === anchorId);
  }

  async add(record: ArchiveRecord): Promise<void> {
    const data = await this.load();
    const next: ArchiveFile = {
      version: 1,
      sessionId: this.sessionId,
      archives: [...data.archives, record],
    };
    await this.write(next);
    this.cache = next;
  }

  async removeByAnchor(anchorId: string): Promise<ArchiveRecord | undefined> {
    const data = await this.load();
    let removed: ArchiveRecord | undefined;
    const remaining: ArchiveRecord[] = [];
    for (const a of data.archives) {
      if (!removed && a.anchorId === anchorId) {
        removed = a;
        continue;
      }
      remaining.push(a);
    }
    if (!removed) return undefined;
    const next: ArchiveFile = {
      version: 1,
      sessionId: this.sessionId,
      archives: remaining,
    };
    await this.write(next);
    this.cache = next;
    return removed;
  }

  private async write(data: ArchiveFile): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }
}
