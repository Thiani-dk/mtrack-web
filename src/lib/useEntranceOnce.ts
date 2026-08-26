import { useEffect, useState } from 'react';
import { wasNewlyCreatedMessage, clearNewlyCreatedMessage } from './useChatSession';

// Whether this message mounted for the first time right after being created
// live (vs. loaded in bulk from IndexedDB history). The lazy initializer only
// reads (never mutates), so it's safe under a render-phase double-invoke; the
// flag is cleared in an effect afterwards — idempotent, so a later remount of
// the same message id (switching sessions and back) never replays.
export function useEntranceOnce(messageId: string): boolean {
    const [playEntrance] = useState(() => wasNewlyCreatedMessage(messageId));

    useEffect(() => {
        clearNewlyCreatedMessage(messageId);
    }, [messageId]);

    return playEntrance;
}
