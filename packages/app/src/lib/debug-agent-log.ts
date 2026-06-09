export function debugAgentLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  // #region agent log
  // eslint-disable-next-line no-console
  console.log(`[agent-debug][${hypothesisId}] ${message}`, { location, ...data });
  fetch("http://127.0.0.1:7811/ingest/daa174af-74be-48e1-9656-4b50f1e7b673", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "037e55",
    },
    body: JSON.stringify({
      sessionId: "037e55",
      location,
      message,
      data,
      hypothesisId,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}
