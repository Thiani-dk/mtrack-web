import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { registerServiceWorker } from '../lib/registerServiceWorker';

// Registers the service worker and, when a new version has installed and is
// waiting, shows a small banner. Tapping Refresh promotes the waiting worker
// and reloads the page onto the new build. Renders nothing until then.
export function ServiceWorkerUpdater() {
    const [promote, setPromote] = useState<(() => void) | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        // Store the function itself, not the result of calling it.
        registerServiceWorker(doPromote => setPromote(() => doPromote));
    }, []);

    if (!promote) return null;

    const handleRefresh = () => {
        setRefreshing(true);
        promote();
        // controllerchange normally does the reload; this is a backstop for the
        // case where the new worker is already active and nothing fires.
        setTimeout(() => window.location.reload(), 2000);
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            className="glass-panel"
            style={{
                position: 'fixed',
                left: '50%',
                transform: 'translateX(-50%)',
                bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
                zIndex: 60,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 12px 10px 16px',
                borderRadius: '14px',
                maxWidth: 'calc(100vw - 24px)',
            }}
            role="status"
        >
            <span className="text-sm text-[var(--text-primary)]">A new version is available.</span>
            <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className="btn-primary text-sm font-medium rounded-lg px-3 py-1.5 flex-shrink-0 disabled:opacity-60"
            >
                {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
        </motion.div>
    );
}
