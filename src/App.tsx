import { useEffect, useState } from 'react';
import type { AppState, ParsedTransaction, InputSource } from './types';
import { getCutoffDate, getDaysLabel } from './lib/dateUtils';
import { parseAllSMS } from './lib/smsParser';
import { HomeScreen } from './components/HomeScreen';
import { TimeRangeScreen } from './components/TimeRangeScreen';
import { InputScreen } from './components/InputScreen';
import { ReviewScreen } from './components/ReviewScreen';
import { OutputScreen } from './components/OutputScreen';

export default function App() {
    const [state, setState] = useState<AppState>({
        step: 'home',
        timeRange: null,
        smsText: '',
        cutoffDate: null,
        inputSource: 'manual',
    });
    const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);

    // ── Share target handler ─────────────────────────────────────────────────
    // When the PWA is opened via Android Share, the OS appends
    // ?text=<shared content> to /share-target. We read it synchronously on
    // first render and pass it to InputScreen as a pre-filled value.

    const [sharedText, setSharedText] = useState<string | null>(() => {
        const params = new URLSearchParams(window.location.search);
        const text = params.get('text') ?? params.get('title') ?? null;
        return text && text.trim().length > 0 ? text.trim() : null;
    });

    useEffect(() => {
        if (sharedText) {
            // Clean the URL so refresh doesn't re-trigger
            window.history.replaceState({}, '', '/');
        }
    }, [sharedText]);

    // ── M-PESA flow ──────────────────────────────────────────────────────────

    const handleHomeSelect = () => {
        setState(prev => ({ ...prev, step: 'timeRange' }));
    };

    const handleTimeRangeSelect = (range: 'week' | 'month' | '3months' | '6months' | 'year') => {
        setState(prev => ({
            ...prev,
            timeRange: range,
            cutoffDate: getCutoffDate(range),
            step: 'input',
        }));
    };

    const handleInputSubmit = (text: string, source: InputSource) => {
        // Clear shared text once consumed
        setSharedText(null);
        const parsed = parseAllSMS(text);
        setTransactions(parsed);
        setState(prev => ({ ...prev, smsText: text, inputSource: source, step: 'review' }));
    };

    const handleReviewConfirm = (labelled: ParsedTransaction[]) => {
        setTransactions(labelled);
        setState(prev => ({ ...prev, step: 'output' }));
    };

    // ── Shared ───────────────────────────────────────────────────────────────

    const handleReset = () => {
        setState({ step: 'home', timeRange: null, smsText: '', cutoffDate: null, inputSource: 'manual' });
        setTransactions([]);
        setSharedText(null);
    };

    const renderStep = () => {
        switch (state.step) {
            case 'home':
                return <HomeScreen onSelect={handleHomeSelect} />;

            case 'timeRange':
                return (
                    <TimeRangeScreen
                        onSelect={handleTimeRangeSelect}
                        onBack={() => setState(prev => ({ ...prev, step: 'home' }))}
                    />
                );

            case 'input':
                return (
                    <InputScreen
                        range={state.timeRange!}
                        cutoffDate={state.cutoffDate!}
                        initialText={sharedText ?? ''}
                        onSubmit={handleInputSubmit}
                        onBack={() => setState(prev => ({ ...prev, step: 'timeRange' }))}
                    />
                );

            case 'review':
                return (
                    <ReviewScreen
                        transactions={transactions}
                        onConfirm={handleReviewConfirm}
                        onBack={() => setState(prev => ({ ...prev, step: 'input' }))}
                    />
                );

            case 'output':
                return (
                    <OutputScreen
                        transactions={transactions}
                        dateRangeLabel={getDaysLabel(state.timeRange!)}
                        inputSource={state.inputSource}
                        onReset={handleReset}
                        onBack={() => setState(prev => ({ ...prev, step: 'review' }))}
                    />
                );

            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen bg-[var(--bg-base)]">
            <div className="max-w-md mx-auto min-h-screen">
                {renderStep()}
            </div>
        </div>
    );
}