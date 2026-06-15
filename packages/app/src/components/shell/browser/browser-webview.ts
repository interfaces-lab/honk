export interface BrowserWebviewCaptureImage {
  toDataURL: () => string;
}

export function browserWebviewHardReload(webview: HTMLWebViewElement): void {
  if (typeof webview.reloadIgnoringCache === "function") {
    webview.reloadIgnoringCache();
    return;
  }
  webview.reload();
}

export function browserWebviewOpenDevTools(webview: HTMLWebViewElement): void {
  webview.openDevTools?.();
}

export function browserWebviewClearHistory(webview: HTMLWebViewElement): void {
  webview.clearHistory?.();
}

export function browserWebviewCapturePage(webview: HTMLWebViewElement): Promise<string | null> {
  const capturePage = webview.capturePage;
  if (typeof capturePage !== "function") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    capturePage.call(webview, (image: BrowserWebviewCaptureImage) => {
      try {
        resolve(image.toDataURL());
      } catch {
        resolve(null);
      }
    });
  });
}

export async function copyBrowserScreenshotDataUrl(dataUrl: string): Promise<boolean> {
  if (typeof window === "undefined" || !navigator.clipboard?.write) {
    return false;
  }

  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob,
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}
