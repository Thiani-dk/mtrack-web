import { useState } from 'react';
import type { AppState, ParsedTransaction } from './types';
import { getCutoffDate, getDaysLabel } from './lib/dateUtils';
import { parseAllSMS } from './lib/smsParser';
import { HomeScreen } from './components/HomeScreen';
import { TimeRangeScreen } from './components/TimeRangeScreen';
import { InputScreen } from './components/InputScreen';
import { ReviewScreen } from './components/ReviewScreen';
import { OutputScreen } from './components/OutputScreen';

export default function App() {
    const [state, setState] = useState<AppState>({
        mode: null,
        step: 'home',
        timeRange: null,
        smsText: '',
        cutoffDate: null,
    });
    const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);

    const handleHomeSelect = (mode: 'receipt' | 'ledger') => {
        setState(prev => ({ ...prev, mode, step: 'timeRange' }));
    };

    const handleTimeRangeSelect = (range: 'week' | 'month' | '3months' | '6months' | 'year') => {
        setState(prev => ({
            ...prev,
            timeRange: range,
            cutoffDate: getCutoffDate(range),
            step: 'input',
        }));
    };

    const handleInputSubmit = (text: string) => {
        const parsed = parseAllSMS(text);
        setTransactions(parsed);
        setState(prev => ({ ...prev, smsText: text, step: 'review' }));
    };

    const handleReviewConfirm = (labelled: ParsedTransaction[]) => {
        setTransactions(labelled);
        setState(prev => ({ ...prev, step: 'output' }));
    };

    const handleReset = () => {
        setState({ mode: null, step: 'home', timeRange: null, smsText: '', cutoffDate: null });
        setTransactions([]);
    };

    const renderStep = () => {
        switch (state.step) {
            case 'home':
                return <HomeScreen onSelect={handleHomeSelect} />;
            case 'timeRange':
                return (
                    <TimeRangeScreen
                        mode={state.mode!}
                        onSelect={handleTimeRangeSelect}
                        onBack={() => setState(prev => ({ ...prev, step: 'home', mode: null }))}
                    />
                );
            case 'input':
                return (
                    <InputScreen
                        mode={state.mode!}
                        range={state.timeRange!}
                        cutoffDate={state.cutoffDate!}
                        onSubmit={handleInputSubmit}
                        onBack={() => setState(prev => ({ ...prev, step: 'timeRange' }))}
                    />
                );
            case 'review':
                return (
                    <ReviewScreen
                        mode={state.mode!}
                        transactions={transactions}
                        onConfirm={handleReviewConfirm}
                        onBack={() => setState(prev => ({ ...prev, step: 'input' }))}
                    />
                );
            case 'output':
                return (
                    <OutputScreen
                        mode={state.mode!}
                        range={state.timeRange!}
                        transactions={transactions}
                        dateRangeLabel={getDaysLabel(state.timeRange!)}
                        onReset={handleReset}
                        onBack={() => setState(prev => ({ ...prev, step: 'review' }))}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen bg-gray-100">
            <div className="max-w-md mx-auto min-h-screen bg-white shadow-sm">
                {renderStep()}
            </div>
        </div>
    );
}
