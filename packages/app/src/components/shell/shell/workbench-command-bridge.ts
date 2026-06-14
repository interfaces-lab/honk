export type WorkbenchCommandEvent = "editorPanelNewTabMenuRequested";

const workbenchCommandTarget = new EventTarget();

export function emitWorkbenchCommand(eventName: WorkbenchCommandEvent): void {
  workbenchCommandTarget.dispatchEvent(new Event(eventName));
}

export function subscribeWorkbenchCommand(
  eventName: WorkbenchCommandEvent,
  callback: () => void,
): () => void {
  const listener = () => callback();
  workbenchCommandTarget.addEventListener(eventName, listener);
  return () => workbenchCommandTarget.removeEventListener(eventName, listener);
}
