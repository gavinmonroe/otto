// ---------------------------------------------------------------------------
// Queue Bridge — shared port management for queue subscriptions on the MR page.
//
// The MR content script creates a queue port to receive live updates.
// The useReview hook needs to disconnect it when the user cancels.
// This module provides a shared reference so both can access it without
// circular imports.
// ---------------------------------------------------------------------------

let mrQueuePort: chrome.runtime.Port | null = null;

export function setMrQueuePort(port: chrome.runtime.Port | null): void {
  mrQueuePort = port;
}

export function getMrQueuePort(): chrome.runtime.Port | null {
  return mrQueuePort;
}

export function disconnectMrQueuePort(): void {
  if (mrQueuePort) {
    try { mrQueuePort.disconnect(); } catch { /* already disconnected */ }
    mrQueuePort = null;
  }
}
