import { useCallback, useState } from 'react';
import { ClipboardPaste, X } from 'lucide-react';
import {
    CLIPBOARD_FAILURE_MESSAGE, dismissPasteTip, hasSeenPasteTip,
    isClipboardReadSupported, PASTE_TIP_MESSAGE, readClipboardText,
} from '../lib/clipboardRead';

// One Paste button, used by Active Mode's capture field and by the chat
// composer. Both places have the same friction and there is no reason for two
// implementations of it to drift apart.
//
// It renders nothing at all where clipboard reading is unavailable, so the
// caller does not have to feature-detect: dropping <PasteButton> next to a
// field is the whole integration. Onboarding copy that needs to know whether
// the button exists asks isClipboardReadSupported directly.

interface PasteButtonProps {
    // Handed the clipboard text. The caller feeds it into whatever path a
    // manual paste already takes — this component deliberately knows nothing
    // about parsing.
    onText: (text: string) => void;
    // Where the failure line should appear relative to the button. Active Mode
    // has room above it; the composer does not.
    notePlacement?: 'below' | 'above';
    disabled?: boolean;
    className?: string;
    // Show the one-time "tap here to paste" line the first time this button is
    // ever seen. Only the chat composer asks for it — Active Mode's own
    // walkthrough already covers the button there, and two explanations of the
    // same control is one too many.
    firstRunTip?: boolean;
}

export function PasteButton({
    onText, notePlacement = 'below', disabled = false, className = '', firstRunTip = false,
}: PasteButtonProps) {
    const [failed, setFailed] = useState(false);
    const [tipOpen, setTipOpen] = useState(() => firstRunTip && !hasSeenPasteTip());
    // Checked at render rather than once at module load, so a browser that
    // gains the API (or a test that stubs it) is not stuck with a stale answer.
    const supported = isClipboardReadSupported();

    const closeTip = useCallback(() => {
        setTipOpen(open => {
            if (open) dismissPasteTip();
            return false;
        });
    }, []);

    const handleClick = useCallback(async () => {
        // Inside the click, which is the user gesture both platforms require.
        const result = await readClipboardText();
        // Using the button is the best possible acknowledgement of the tip.
        closeTip();
        if (result.failure) {
            setFailed(true);
            return;
        }
        setFailed(false);
        onText(result.text);
    }, [onText, closeTip]);

    if (!supported) return null;

    const tip = tipOpen ? (
        <div
            role="note"
            data-paste-tip
            className="flex items-start gap-1.5 rounded-lg px-2 py-1.5 max-w-[15rem]"
            style={{ background: 'var(--accent-subtle)' }}
        >
            <span className="text-[10px] text-[var(--text-secondary)] leading-snug">
                {PASTE_TIP_MESSAGE}
            </span>
            <button
                type="button"
                onClick={closeTip}
                aria-label="Dismiss tip"
                className="flex-shrink-0 text-[var(--text-muted)]"
            >
                <X className="w-3 h-3" />
            </button>
        </div>
    ) : null;

    const note = failed ? (
        <p role="status" className="text-[10px] text-[var(--text-muted)] leading-snug max-w-[14rem]">
            {CLIPBOARD_FAILURE_MESSAGE}
        </p>
    ) : null;

    return (
        <div className={`flex flex-col ${notePlacement === 'above' ? 'flex-col-reverse' : ''} gap-1 ${className}`}>
            <button
                type="button"
                onClick={handleClick}
                disabled={disabled}
                data-paste-button
                aria-label="Paste from clipboard"
                className="flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs text-[var(--text-secondary)] whitespace-nowrap disabled:opacity-50"
                style={{ borderColor: 'var(--border-glass)' }}
            >
                <ClipboardPaste className="w-3.5 h-3.5" />
                Paste
            </button>
            {note}
            {tip}
        </div>
    );
}
