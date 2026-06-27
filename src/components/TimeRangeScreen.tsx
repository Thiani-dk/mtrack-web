import { ArrowLeft } from 'lucide-react';
import { TimeRange } from '../types';

interface TimeRangeScreenProps {
    mode: 'receipt' | 'ledger';
    onSelect: (range: TimeRange) => void;
    onBack: () => void;
}

const rangeOptions: {
    value: TimeRange;
    label: string;
    subLabel: string;
}[] = [
    { value: 'week', label: 'Past Week', subLabel: '7 days of transactions' },
    { value: 'month', label: 'Past Month', subLabel: '30 days of transactions' },
    { value: '3months', label: 'Past 3 Months', subLabel: '90 days of transactions' },
    { value: '6months', label: 'Past 6 Months', subLabel: '180 days of transactions' },
    { value: 'year', label: 'Past Year', subLabel: '365 days of transactions' },
];

export function TimeRangeScreen({ mode, onSelect, onBack }: TimeRangeScreenProps) {
    return (
        <div className="flex flex-col min-h-screen animate-in fade-in slide-in-from-bottom-4 duration-200">
            {/* Persistent Header */}
            <div className="sticky top-0 z-10 h-14 bg-white border-b border-gray-200 flex items-center px-4">
                <button 
                    onClick={onBack}
                    className="flex items-center text-gray-600 hover:text-gray-900"
                >
                    <ArrowLeft className="w-5 h-5 mr-1" />
                </button>
                <div className="flex-1 text-center">
                    <span className="text-sm font-medium text-gray-900">M-PESA Manager</span>
                </div>
                <div className="w-10"></div> {/* Spacer for balance */}
            </div>

            <div className="flex-1 p-4">
                <div className="max-w-md w-full mx-auto space-y-6">
                    <div className="text-center">
                        <h1 className="text-2xl font-bold text-gray-900">
                            {mode === 'receipt' ? 'Receipt Period' : 'Ledger Period'}
                        </h1>
                        <p className="mt-2 text-gray-600">
                            How far back should we look?
                        </p>
                    </div>

                    <div className="space-y-3">
                        {rangeOptions.map((option) => (
                            <button
                                key={option.value}
                                onClick={() => onSelect(option.value)}
                                className="w-full min-h-[48px] p-4 text-left bg-white border border-gray-200 rounded-lg hover:border-[#00A651] hover:shadow-md transition-all"
                            >
                                <div className="font-medium text-gray-900">{option.label}</div>
                                <div className="text-sm text-gray-500">{option.subLabel}</div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
