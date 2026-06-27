import { useState } from 'react';
import type { TimeRange } from '../types';
import { formatCutoffDisplay } from '../lib/dateUtils';
import { ArrowLeft } from 'lucide-react';

interface InputScreenProps {
    mode: 'receipt' | 'ledger';
    range: TimeRange;
    cutoffDate: Date;
    onSubmit: (text: string) => void;
    onBack: () => void;
}

export function InputScreen({ mode, cutoffDate, onSubmit, onBack }: InputScreenProps) {
    const [smsText, setSmsText] = useState('');

    const handleSubmit = () => {
        if (smsText.trim()) {
            onSubmit(smsText);
        }
    };

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
                    <h1 className="text-2xl font-bold text-gray-900 text-center">
                        Paste your SMS messages
                    </h1>

                    <div className="border-l-4 border-amber-500 bg-amber-50 rounded-r-lg p-4 space-y-2">
                        <h2 className="font-bold text-amber-800">Important: Date limit</h2>
                        <p className="text-amber-800">
                            Only include M-PESA messages from after <span className="font-bold text-[#00A651]">{formatCutoffDisplay(cutoffDate)}</span>. 
                            Messages before this date are outside your selected period — but any messages you include will still be processed.
                        </p>
                        <p className="text-sm text-amber-600">
                            Tip: In your SMS app, scroll to <span className="font-semibold">{formatCutoffDisplay(cutoffDate)}</span> and start selecting from there.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <textarea
                            value={smsText}
                            onChange={(e) => setSmsText(e.target.value)}
                            placeholder="Paste all your M-PESA confirmation messages here...\n\nExample:\nQHJ4X2K9LP Confirmed. You have received Ksh500.00 from JOHN DOE..."
                            className="w-full p-3 border border-gray-300 rounded-lg min-h-[200px] focus:border-[#00A651] focus:ring-1 focus:ring-[#00A651]"
                        />
                        <p className="text-sm text-gray-500">
                            {smsText.length} characters
                        </p>
                    </div>

                    <button
                        onClick={handleSubmit}
                        disabled={!smsText.trim()}
                        className={`w-full min-h-[48px] py-3 px-4 rounded-lg font-medium ${
                            smsText.trim() 
                                ? 'bg-[#00A651] text-white hover:bg-[#008a43]'
                                : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                        }`}
                    >
                        Generate {mode === 'receipt' ? 'Receipt' : 'Ledger'}
                    </button>
                </div>
            </div>
        </div>
    );
}
