import { ipcRenderer } from "electron";

function sendKeyboardEventToHost(event: KeyboardEvent): void {
  ipcRenderer.sendToHost("browser-keydown", {
    altKey: event.altKey,
    code: event.code,
    ctrlKey: event.ctrlKey,
    key: event.key,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    type: event.type,
  });
}

window.addEventListener("keydown", sendKeyboardEventToHost, true);
