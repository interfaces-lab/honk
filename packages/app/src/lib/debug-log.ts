const DEBUG_LOG_URL = "http://127.0.0.1:49394/log";
const DEBUG_LOG_LIMIT = 400;

declare global {
  interface Window {
    __multiDebugLogCount?: number;
  }
}

export function debugLog(event: string, data: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") {
    return;
  }

  const count = (window.__multiDebugLogCount ?? 0) + 1;
  window.__multiDebugLogCount = count;
  if (count > DEBUG_LOG_LIMIT) {
    return;
  }

  const payload = {
    event,
    count,
    href: window.location.href,
    at: new Date().toISOString(),
    ...data,
  };

  void fetch(DEBUG_LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}
