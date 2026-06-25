let pendingKickNotice: string | null = null;

export function setKickNotice(msg: string) {
  pendingKickNotice = msg;
}

export function consumeKickNotice(): string | null {
  const msg = pendingKickNotice;
  pendingKickNotice = null;
  return msg;
}
