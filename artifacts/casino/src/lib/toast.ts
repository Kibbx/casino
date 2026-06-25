export type ToastType = "error" | "success" | "info";
export type ToastMsg = { id: number; msg: string; type: ToastType };

type ToastListener = (toasts: ToastMsg[]) => void;
let _toasts: ToastMsg[] = [];
let _nextId = 0;
const _listeners: ToastListener[] = [];

function _notify() { _listeners.forEach(l => l([..._toasts])); }

export function showToast(msg: string, type: ToastType = "error") {
  const id = _nextId++;
  _toasts.push({ id, msg, type });
  _notify();
  setTimeout(() => {
    _toasts = _toasts.filter(t => t.id !== id);
    _notify();
  }, 4000);
}

export function subscribeToasts(fn: ToastListener): () => void {
  _listeners.push(fn);
  fn([..._toasts]);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i >= 0) _listeners.splice(i, 1);
  };
}
