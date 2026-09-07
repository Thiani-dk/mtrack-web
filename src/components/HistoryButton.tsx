import { motion } from 'framer-motion';
import { History } from 'lucide-react';
import { useDocumentStore } from '../lib/useDocumentStore';

export function HistoryButton({ onClick }: { onClick: () => void }) {
    const { documents } = useDocumentStore();

    return (
        <motion.button
            onClick={onClick}
            className="btn-secondary w-full min-h-[48px] rounded-2xl text-sm font-medium flex items-center justify-center gap-2"
            whileTap={{ scale: 0.97 }}
        >
            <History className="w-4 h-4" />
            Your documents ({documents.length})
        </motion.button>
    );
}
