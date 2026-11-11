// A stand-in for expo-sqlite in tests, backed by Node's built-in SQLite: the app's real
// SQL runs against a real (in-memory) database. Use it with
//   jest.mock('expo-sqlite', () => require('@/testing/fakeSqlite'));
// Only the methods src/lib uses are implemented.
import { DatabaseSync } from 'node:sqlite';

type Param = string | number | null;

type FakeDb = {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T>(sql: string, params?: Param[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: Param[]): Promise<T | null>;
  runAsync(sql: string, params?: Param[]): Promise<{ changes: number; lastInsertRowId: number }>;
  withTransactionAsync(work: () => Promise<void>): Promise<void>;
  withExclusiveTransactionAsync(work: (tx: FakeDb) => Promise<void>): Promise<void>;
};

function wrap(db: DatabaseSync): FakeDb {
  const api: FakeDb = {
    async execAsync(sql: string) {
      db.exec(sql);
    },
    async getAllAsync<T>(sql: string, params: Param[] = []): Promise<T[]> {
      // Plain objects, like expo-sqlite returns (node:sqlite rows have no prototype).
      return db.prepare(sql).all(...params).map((row) => ({ ...row })) as T[];
    },
    async getFirstAsync<T>(sql: string, params: Param[] = []): Promise<T | null> {
      const row = db.prepare(sql).get(...params);
      return row ? ({ ...row } as T) : null;
    },
    async runAsync(sql: string, params: Param[] = []) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async withTransactionAsync(work: () => Promise<void>) {
      db.exec('BEGIN');
      try {
        await work();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async withExclusiveTransactionAsync(work: (tx: FakeDb) => Promise<void>) {
      await api.withTransactionAsync(() => work(api));
    },
  };
  return api;
}

export async function openDatabaseAsync(_name: string) {
  return wrap(new DatabaseSync(':memory:'));
}
