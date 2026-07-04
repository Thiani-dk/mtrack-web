import { useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import type {
    DeclutterAnswers,
    GmailAge,
    GmailContent,
    GmailStorage,
    GmailRuthlessness,
    GmailKeepSafe,
} from '../types';

interface Props {
    onComplete: (answers: DeclutterAnswers) => void;
    onBack: () => void;
}

const TOTAL_STEPS = 5;

const slideIn: Variants = {
    initial: { opacity: 0, x: 40 },
    animate: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 380, damping: 28 } },
    exit:    { opacity: 0, x: -40, transition: { duration: 0.18 } },
};

const CONTENT_OPTIONS: { key: GmailContent; emoji: string; label: string }[] = [
    { key: 'shopping',    emoji: '🛍️', label: 'Shopping & offers' },
    { key: 'newsletters', emoji: '📰', label: 'Newsletters I never read' },
    { key: 'social',      emoji: '📱', label: 'Social media alerts' },
    { key: 'financial',   emoji: '💰', label: 'Bank & financial alerts' },
    { key: 'delivery',    emoji: '📦', label: 'Delivery & order updates' },
    { key: 'calendar',    emoji: '🗓️', label: 'Calendar & meeting invites' },
    { key: 'work',        emoji: '💼', label: 'Work / HR system emails' },
    { key: 'apps',        emoji: '🎮', label: 'Apps & games notifications' },
];

const KEEP_OPTIONS: { key: GmailKeepSafe; emoji: string; label: string }[] = [
    { key: 'starred',   emoji: '⭐', label: 'Starred emails — safe' },
    { key: 'important', emoji: '📌', label: 'Important-marked — safe' },
    { key: 'primary',   emoji: '📥', label: 'Primary inbox — safe' },
];

function ProgressBar({ step }: { step: number }) {
    return (
        <div className="w-full bg-gray-100 rounded-full h-1.5 mb-6">
            <motion.div
                className="h-1.5 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
                initial={{ width: 0 }}
                animate={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
        </div>
    );
}

function QuestionLabel({ step, total, text }: { step: number; total: number; text: string }) {
    return (
        <div className="mb-5">
            <p className="text-xs font-medium text-indigo-500 uppercase tracking-wider mb-1">
                Question {step} of {total}
            </p>
            <h2 className="text-lg font-semibold text-gray-900 leading-snug">{text}</h2>
        </div>
    );
}

export function DeclutterDiagnosticScreen({ onComplete, onBack }: Props) {
    const [step, setStep] = useState(1);
    const [answers, setAnswers] = useState<DeclutterAnswers>({
        age: null,
        content: [],
        storage: null,
        ruthlessness: null,
        keepSafe: [],
    });

    function canAdvance(): boolean {
        switch (step) {
            case 1: return answers.age !== null;
            case 2: return answers.content.length > 0;
            case 3: return answers.storage !== null;
            case 4: return answers.ruthlessness !== null;
            case 5: return true; // keep-safe is optional
            default: return false;
        }
    }

    function advance() {
        if (step < TOTAL_STEPS) {
            setStep(s => s + 1);
        } else {
            onComplete(answers);
        }
    }

    function SingleChoice<T extends string>({
        value,
        options,
        onChange,
    }: {
        value: T | null;
        options: { value: T; label: string; emoji?: string; sublabel?: string }[];
        onChange: (v: T) => void;
    }) {
        return (
            <div className="space-y-3">
                {options.map(opt => (
                    <button
                        key={opt.value}
                        onClick={() => onChange(opt.value)}
                        className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all duration-150 ${
                            value === opt.value
                                ? 'border-indigo-400 bg-indigo-50 shadow-sm'
                                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            {opt.emoji && <span className="text-xl">{opt.emoji}</span>}
                            <div className="flex-1">
                                <p className={`text-sm font-medium ${value === opt.value ? 'text-indigo-700' : 'text-gray-800'}`}>
                                    {opt.label}
                                </p>
                                {opt.sublabel && (
                                    <p className="text-xs text-gray-400 mt-0.5">{opt.sublabel}</p>
                                )}
                            </div>
                            {value === opt.value && (
                                <Check className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                            )}
                        </div>
                    </button>
                ))}
            </div>
        );
    }

    function MultiChoice<T extends string>({
        values,
        options,
        onChange,
    }: {
        values: T[];
        options: { key: T; emoji: string; label: string }[];
        onChange: (v: T[]) => void;
    }) {
        const toggle = (key: T) => {
            onChange(
                values.includes(key)
                    ? values.filter(v => v !== key)
                    : [...values, key]
            );
        };
        return (
            <div className="grid grid-cols-2 gap-2">
                {options.map(opt => {
                    const selected = values.includes(opt.key);
                    return (
                        <button
                            key={opt.key}
                            onClick={() => toggle(opt.key)}
                            className={`text-left px-3 py-3 rounded-xl border transition-all duration-150 ${
                                selected
                                    ? 'border-indigo-400 bg-indigo-50'
                                    : 'border-gray-200 bg-white hover:border-gray-300'
                            }`}
                        >
                            <div className="flex items-start gap-2">
                                <span className="text-lg mt-0.5">{opt.emoji}</span>
                                <p className={`text-xs font-medium leading-snug ${selected ? 'text-indigo-700' : 'text-gray-700'}`}>
                                    {opt.label}
                                </p>
                            </div>
                            {selected && (
                                <div className="mt-1.5 flex justify-end">
                                    <Check className="w-3.5 h-3.5 text-indigo-400" />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        );
    }

    function renderStep() {
        switch (step) {
            case 1:
                return (
                    <>
                        <QuestionLabel step={1} total={TOTAL_STEPS} text="How old is your Gmail account?" />
                        <SingleChoice<GmailAge>
                            value={answers.age}
                            onChange={v => setAnswers(a => ({ ...a, age: v }))}
                            options={[
                                { value: 'under2', label: 'Under 2 years',   sublabel: 'Recently set up' },
                                { value: '2to5',   label: '2–5 years',       sublabel: 'A few years of build-up' },
                                { value: '5plus',  label: '5+ years',        sublabel: 'Could use some serious excavating' },
                            ]}
                        />
                    </>
                );
            case 2:
                return (
                    <>
                        <QuestionLabel step={2} total={TOTAL_STEPS} text="What fills your inbox? Pick everything that applies." />
                        <MultiChoice<GmailContent>
                            values={answers.content}
                            options={CONTENT_OPTIONS}
                            onChange={v => setAnswers(a => ({ ...a, content: v }))}
                        />
                    </>
                );
            case 3:
                return (
                    <>
                        <QuestionLabel step={3} total={TOTAL_STEPS} text="Are you worried about storage?" />
                        <SingleChoice<GmailStorage>
                            value={answers.storage}
                            onChange={v => setAnswers(a => ({ ...a, storage: v }))}
                            options={[
                                { value: 'full',     emoji: '🔴', label: 'Yes — Gmail says I\'m nearly full',  sublabel: 'Will add aggressive attachment cleaners' },
                                { value: 'somewhat', emoji: '🟡', label: 'Somewhat — getting there',           sublabel: 'Will add moderate attachment cleaners' },
                                { value: 'fine',     emoji: '🟢', label: 'No — storage is fine',              sublabel: 'Skip attachment-specific commands' },
                            ]}
                        />
                    </>
                );
            case 4:
                return (
                    <>
                        <QuestionLabel step={4} total={TOTAL_STEPS} text="How ruthless do you want to be?" />
                        <SingleChoice<GmailRuthlessness>
                            value={answers.ruthlessness}
                            onChange={v => setAnswers(a => ({ ...a, ruthlessness: v }))}
                            options={[
                                { value: 'light',   emoji: '🧹', label: 'Light clean',  sublabel: 'Only obvious junk — older than 1 year' },
                                { value: 'deep',    emoji: '🔥', label: 'Deep clean',   sublabel: 'Nuke everything old — older than 6 months' },
                                { value: 'nuclear', emoji: '☢️',  label: 'Nuclear',      sublabel: 'Inbox zero — older than 3 months' },
                            ]}
                        />
                    </>
                );
            case 5:
                return (
                    <>
                        <QuestionLabel step={5} total={TOTAL_STEPS} text="Anything you absolutely want to keep?" />
                        <p className="text-xs text-gray-400 mb-4 -mt-3">
                            These will be excluded from every command. Optional — skip if you want nothing protected.
                        </p>
                        <MultiChoice<GmailKeepSafe>
                            values={answers.keepSafe}
                            options={KEEP_OPTIONS}
                            onChange={v => setAnswers(a => ({ ...a, keepSafe: v }))}
                        />
                    </>
                );
            default:
                return null;
        }
    }

    return (
        <div className="flex flex-col min-h-screen bg-white">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
                <button
                    onClick={step === 1 ? onBack : () => setStep(s => s - 1)}
                    className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 transition-colors"
                >
                    <ArrowLeft className="w-5 h-5 text-gray-500" />
                </button>
                <div>
                    <h1 className="text-base font-semibold text-gray-900">Clean My Gmail</h1>
                    <p className="text-xs text-gray-400">Quick diagnostic — 5 questions</p>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 px-5 pt-6 pb-4 overflow-y-auto">
                <ProgressBar step={step} />
                <AnimatePresence mode="wait">
                    <motion.div
                        key={step}
                        variants={slideIn}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                    >
                        {renderStep()}
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* Footer nav */}
            <div className="px-5 py-4 border-t border-gray-100">
                <motion.button
                    onClick={advance}
                    disabled={!canAdvance()}
                    className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm transition-all ${
                        canAdvance()
                            ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md shadow-indigo-200'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                    whileTap={canAdvance() ? { scale: 0.97 } : {}}
                >
                    {step === TOTAL_STEPS ? 'Generate My Commands' : 'Next'}
                    <ArrowRight className="w-4 h-4" />
                </motion.button>
            </div>
        </div>
    );
}