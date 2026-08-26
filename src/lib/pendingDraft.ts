// Tracks unconfirmed shared-text sitting in the chat composer, persisted
// across the hard page reload a repeat Android share-target invocation
// causes (see manifest.json's share_target — it's a real GET navigation,
// not a same-page event, so in-memory state alone can't survive it).
// sessionStorage, not localStorage: this is scoped to "still open right
// now", not meant to outlive the tab.

const KEY = 'mtrack-pending-draft';

export function getPendingDraft(): string {
    try {
        return sessionStorage.getItem(KEY) ?? '';
    } catch {
        return '';
    }
}

export function setPendingDraft(text: string): void {
    try {
        if (text.trim().length === 0) sessionStorage.removeItem(KEY);
        else sessionStorage.setItem(KEY, text);
    } catch {
        // sessionStorage unavailable (private browsing, quota, etc) — pending
        // text just won't be tracked across a reload; a share still populates
        // the composer fine, it just never shows the "already have something
        // pending" prompt. Degrades gracefully, doesn't break sharing.
    }
}

export function clearPendingDraft(): void {
    try {
        sessionStorage.removeItem(KEY);
    } catch {
        // no-op — see setPendingDraft
    }
}
