import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface CacheEntry<T = unknown> {
  value: T;
  fetchedAt: string;
}

/** SQLite key/value cache with a TTL. Keys are request URLs; values are parsed JSON. */
export class Cache {
  private db: Database.Database;

  constructor(path: string, private ttlMs: number, private now: () => number = Date.now) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL)",
    );
  }

  get<T>(key: string): CacheEntry<T> | undefined {
    const row = this.db.prepare("SELECT value, fetched_at FROM cache WHERE key = ?").get(key) as
      | { value: string; fetched_at: number }
      | undefined;
    if (!row) return undefined;
    if (this.now() - row.fetched_at > this.ttlMs) {
      this.db.prepare("DELETE FROM cache WHERE key = ?").run(key);
      return undefined;
    }
    try {
      return { value: JSON.parse(row.value) as T, fetchedAt: new Date(row.fetched_at).toISOString() };
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): string {
    const t = this.now();
    this.db
      .prepare("INSERT OR REPLACE INTO cache (key, value, fetched_at) VALUES (?, ?, ?)")
      .run(key, JSON.stringify(value), t);
    return new Date(t).toISOString();
  }

  close(): void {
    this.db.close();
  }
}
