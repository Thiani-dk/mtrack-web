import { useState } from 'react';
import type { AppState, ParsedTransaction, DeclutterAnswers, DeclutterCommand } from './types';
import { getCutoffDate, getDaysLabel } from './lib/dateUtils';
import { parseAllSMS } from './lib/smsParser';
import { generateDeclutterCommands } from './lib/declutterCommands';
import { HomeScreen } from './components/HomeScreen';
import { TimeRangeScreen } from './components/TimeRangeScreen';
import { InputScreen } from './components/InputScreen';
import { ReviewScreen } from './components/ReviewScreen';
import { OutputScreen } from './components/OutputScreen';
import { DeclutterDiagnosticScreen } from './components/DeclutterDiagnosticScreen';
import { DeclutterOutputScreen } from './components/DeclutterOutputScreen';

export default function App() {
    const [state, setState] = useState<AppState>({
        mode: null,
        step: 'home',
        timeRange: null,
        smsText: '',
        cutoffDate: null,
    });
    const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
    const [declutterCommands, setDeclutterCommands] = useState<DeclutterCommand[]>([]);

    // ── M-PESA flow ──────────────────────────────────────────────────────────

    const handleHomeSelect = (mode: 'receipt' | 'ledger' | 'declutter') => {
        if (mode === 'declutter') {
            setState(prev => ({ ...prev, mode, step: 'declutterDiagnostic' }));
        } else {
            setState(prev => ({ ...prev, mode, step: 'timeRange' }));
        }
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

    // ── Declutter flow ───────────────────────────────────────────────────────

    const handleDeclutterComplete = (answers: DeclutterAnswers) => {
        const commands = generateDeclutterCommands(answers);
        setDeclutterCommands(commands);
        setState(prev => ({ ...prev, step: 'declutterOutput' }));
    };

    const handleDeclutterCommandsChange = (updated: DeclutterCommand[]) => {
        setDeclutterCommands(updated);
    };

    // ── Shared ───────────────────────────────────────────────────────────────

    const handleReset = () => {
        setState({ mode: null, step: 'home', timeRange: null, smsText: '', cutoffDate: null });
        setTransactions([]);
        setDeclutterCommands([]);
    };

    const renderStep = () => {
        switch (state.step) {
            case 'home':
                return <HomeScreen onSelect={handleHomeSelect} />;

            case 'timeRange':
                return (
                    <TimeRangeScreen
                        mode={state.mode as 'receipt' | 'ledger'}
                        onSelect={handleTimeRangeSelect}
                        onBack={() => setState(prev => ({ ...prev, step: 'home', mode: null }))}
                    />
                );

            case 'input':
                return (
                    <InputScreen
                        mode={state.mode as 'receipt' | 'ledger'}
                        range={state.timeRange!}
                        cutoffDate={state.cutoffDate!}
                        onSubmit={handleInputSubmit}
                        onBack={() => setState(prev => ({ ...prev, step: 'timeRange' }))}
                    />
                );

            case 'review':
                return (
                    <ReviewScreen
                        mode={state.mode as 'receipt' | 'ledger'}
                        transactions={transactions}
                        onConfirm={handleReviewConfirm}
                        onBack={() => setState(prev => ({ ...prev, step: 'input' }))}
                    />
                );

            case 'output':
                return (
                    <OutputScreen
                        mode={state.mode as 'receipt' | 'ledger'}
                        transactions={transactions}
                        dateRangeLabel={getDaysLabel(state.timeRange!)}
                        onReset={handleReset}
                        onBack={() => setState(prev => ({ ...prev, step: 'review' }))}
                    />
                );

            case 'declutterDiagnostic':
                return (
                    <DeclutterDiagnosticScreen
                        onComplete={handleDeclutterComplete}
                        onBack={() => setState(prev => ({ ...prev, step: 'home', mode: null }))}
                    />
                );

            case 'declutterOutput':
                return (
                    <DeclutterOutputScreen
                        commands={declutterCommands}
                        onCommandsChange={handleDeclutterCommandsChange}
                        onReset={handleReset}
                        onBack={() => setState(prev => ({ ...prev, step: 'declutterDiagnostic' }))}
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