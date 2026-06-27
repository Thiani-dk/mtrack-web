import { useState } from 'react';
import { AppState, AppStep, ParsedTransaction } from './types';
import { getCutoffDate, getDaysLabel } from './lib/dateUtils';
import { parseAllSMS } from './lib/smsParser';
import { HomeScreen } from './components/HomeScreen';
import { TimeRangeScreen } from './components/TimeRangeScreen';
import { InputScreen } from './components/InputScreen';
import { OutputScreen } from './components/OutputScreen';

function App() {
  const [state, setState] = useState<AppState>({
    mode: null,
    step: 'home',
    timeRange: null,
    smsText: '',
    cutoffDate: null,
  });
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);

  const handleHomeSelect = (mode: 'receipt' | 'ledger') => {
    setState(prev => ({
      ...prev,
      mode,
      step: 'timeRange',
    }));
  };

  const handleTimeRangeSelect = (range: 'week' | 'month' | '3months' | '6months' | 'year') => {
    const cutoffDate = getCutoffDate(range);
    setState(prev => ({
      ...prev,
      timeRange: range,
      cutoffDate,
      step: 'input',
    }));
  };

  const handleTimeRangeBack = () => {
    setState(prev => ({
      ...prev,
      step: 'home',
      mode: null,
      timeRange: null,
      cutoffDate: null,
    }));
  };

  const handleInputSubmit = (text: string) => {
    const parsed = parseAllSMS(text);
    setTransactions(parsed);
    setState(prev => ({
      ...prev,
      smsText: text,
      step: 'output',
    }));
  };

  const handleInputBack = () => {
    setState(prev => ({
      ...prev,
      step: 'timeRange',
    }));
  };

  const handleOutputReset = () => {
    setState({
      mode: null,
      step: 'home',
      timeRange: null,
      smsText: '',
      cutoffDate: null,
    });
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
            onBack={handleTimeRangeBack}
          />
        );
      case 'input':
        return (
          <InputScreen
            mode={state.mode!}
            range={state.timeRange!}
            cutoffDate={state.cutoffDate!}
            onSubmit={handleInputSubmit}
            onBack={handleInputBack}
          />
        );
      case 'output':
        return (
          <OutputScreen
            mode={state.mode!}
            range={state.timeRange!}
            transactions={transactions}
            dateRangeLabel={getDaysLabel(state.timeRange!)}
            onReset={handleOutputReset}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-white max-w-md mx-auto">
      {renderStep()}
    </div>
  );
}

export default App;
