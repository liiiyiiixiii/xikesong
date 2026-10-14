import type { OperationsStore } from './storage.ts';

export async function rows<T>(store: OperationsStore, table: Parameters<OperationsStore['query']>[0], where: Parameters<OperationsStore['query']>[1] = {}): Promise<T[]> {
  const result: T[] = []; let afterId: string | undefined;
  do {
    const page = await store.query<T & { id: string }>(table, { ...where, limit: 1000, afterId });
    result.push(...page); if (page.length < 1000) break; afterId = page.at(-1)!.id;
  } while (true);
  return result;
}
