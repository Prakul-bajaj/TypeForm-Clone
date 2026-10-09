export type ToastKind = "success" | "error" | "info";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}
type Listener = (t: ToastItem) => void;

const listeners = new Set<Listener>();
let seq = 1;

function emit(kind: ToastKind, message: string) {
  const item = { id: seq++, kind, message };
  listeners.forEach((l) => l(item));
}

export const toast = {
  success: (m: string) => emit("success", m),
  error: (m: string) => emit("error", m),
  info: (m: string) => emit("info", m),
  subscribe(l: Listener) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
