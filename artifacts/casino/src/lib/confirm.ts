export type ConfirmReq = { id: number; msg: string; onConfirm: () => void };

type ConfirmListener = (req: ConfirmReq | null) => void;
let _current: ConfirmReq | null = null;
let _nextId = 0;
const _listeners: ConfirmListener[] = [];

function _notify() { _listeners.forEach(l => l(_current)); }

export function showConfirm(msg: string, onConfirm: () => void) {
  _current = { id: _nextId++, msg, onConfirm };
  _notify();
}

export function dismissConfirm() {
  _current = null;
  _notify();
}

export function subscribeConfirm(fn: ConfirmListener): () => void {
  _listeners.push(fn);
  fn(_current);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i >= 0) _listeners.splice(i, 1);
  };
}
