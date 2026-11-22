export interface DbQueryResult<R = any> {
  rows: R[];
  rowCount?: number | null;
}

export interface DbClient {
  query<R = any>(text: string, params?: unknown[]): Promise<DbQueryResult<R>>;
}

export interface PoolLike extends DbClient {
  connect?: () => Promise<PoolClientLike>;
}

export interface PoolClientLike extends DbClient {
  release: () => void;
}

export async function withTransaction<T>(
  clientOrPool: PoolLike,
  fn: (tx: DbClient) => Promise<T>
): Promise<T> {
  // If client is a pool, check out a connection
  if (typeof clientOrPool.connect === 'function') {
    const client = await clientOrPool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Otherwise, use the client directly inside a transaction
  try {
    await clientOrPool.query('BEGIN');
    const result = await fn(clientOrPool);
    await clientOrPool.query('COMMIT');
    return result;
  } catch (err) {
    await clientOrPool.query('ROLLBACK');
    throw err;
  }
}
