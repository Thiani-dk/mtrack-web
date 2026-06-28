import { motion, type Variants } from 'framer-motion';
import { FileText, Table2 } from 'lucide-react';

interface HomeScreenProps {
    onSelect: (mode: 'receipt' | 'ledger') => void;
}

const container: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { staggerChildren: 0.12, delayChildren: 0.1 }
    }
};

const item: Variants = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 28 } }
};

export function HomeScreen({ onSelect }: HomeScreenProps) {
    return (
        <div className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden">

            {/* Ambient background */}
            <div className="absolute inset-0 bg-gradient-to-br from-white via-green-50/40 to-emerald-100/60 pointer-events-none" />
            <div className="absolute top-[-80px] right-[-60px] w-72 h-72 rounded-full bg-[#00A651]/8 blur-3xl pointer-events-none" />
            <div className="absolute bottom-[-40px] left-[-40px] w-56 h-56 rounded-full bg-emerald-300/10 blur-2xl pointer-events-none" />

            <motion.div
                className="relative z-10 w-full max-w-md px-5 space-y-8"
                variants={container}
                initial="hidden"
                animate="show"
            >
                {/* Title */}
                <motion.div variants={item} className="text-center space-y-2 pt-8">
                    <h1 className="text-4xl font-bold tracking-tight text-gray-900">
                        M<span className="text-[#00A651]">-</span>Track
                    </h1>
                    <p className="text-gray-500 text-base">What would you like to do?</p>
                </motion.div>

                {/* Cards */}
                <div className="space-y-4">
                    {[
                        {
                            mode: 'receipt' as const,
                            icon: FileText,
                            title: 'Generate Reimbursement Receipt',
                            desc: 'Export a professional thermal receipt from your M-PESA messages',
                            accent: 'from-green-500 to-emerald-600',
                            shadow: 'shadow-green-500/20',
                        },
                        {
                            mode: 'ledger' as const,
                            icon: Table2,
                            title: 'Organise KRA Ledger',
                            desc: 'Create a daily/monthly CSV ledger for KRA records',
                            accent: 'from-emerald-600 to-teal-600',
                            shadow: 'shadow-teal-500/20',
                        },
                    ].map((card) => (
                        <motion.div key={card.mode} variants={item}>
                            <motion.button
                                onClick={() => onSelect(card.mode)}
                                className="relative w-full text-left bg-white rounded-2xl border border-gray-100 overflow-hidden group"
                                style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}
                                whileHover={{ y: -3, boxShadow: '0 8px 32px rgba(0,0,0,0.10)' }}
                                whileTap={{ scale: 0.975 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                            >
                                {/* Top accent bar */}
                                <div className={`h-1 w-full bg-gradient-to-r ${card.accent}`} />

                                <div className="flex items-start gap-4 p-5">
                                    {/* Icon */}
                                    <div className={`flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br ${card.accent} shadow-lg ${card.shadow}`}>
                                        <card.icon className="w-5 h-5 text-white" />
                                    </div>

                                    {/* Text */}
                                    <div className="flex-1 min-w-0">
                                        <h2 className="text-[15px] font-semibold text-gray-900 leading-snug">
                                            {card.title}
                                        </h2>
                                        <p className="mt-1 text-sm text-gray-500 leading-relaxed">
                                            {card.desc}
                                        </p>
                                    </div>

                                    {/* Arrow */}
                                    <motion.div
                                        className="flex-shrink-0 self-center text-gray-300 group-hover:text-[#00A651]"
                                        initial={{ x: 0 }}
                                        whileHover={{ x: 3 }}
                                        transition={{ type: 'spring', stiffness: 400 }}
                                    >
                                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                            <path d="M7 5l5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </motion.div>
                                </div>
                            </motion.button>
                        </motion.div>
                    ))}
                </div>

                {/* Footer */}
                <motion.p variants={item} className="text-center text-xs text-gray-400 pb-8">
                    Powered by M-PESA SMS data
                </motion.p>
            </motion.div>
        </div>
    );
}