const tableCache = new Map<number, any>();

export function notifyTableUpdate(table: any): void {
  tableCache.set(table.id, table);
}

export function notifyTableDeleted(tableId: number): void {
  tableCache.delete(tableId);
}

export function serializeTable(table: any) {
  const out = {
    ...table,
    createdAt: table.createdAt?.toISOString ? table.createdAt.toISOString() : table.createdAt,
    hasPassword: !!table.password,
    locked: !!table.locked,
  };
  // Strip actual password value — players should never see the raw password
  delete out.password;
  if (out.gameState?.deck !== undefined) {
    const { deck: _deck, ...gsWithoutDeck } = out.gameState;
    out.gameState = gsWithoutDeck;
  }
  return out;
}
