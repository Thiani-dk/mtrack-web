import { useState } from 'react';
import { TimeRange } from '../types';
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
        <div className="flex flex-col min-h-screen p-4">
            <button 
                onClick={onBack}
                className="flex items-center self-start mb-6 text-gray-600 hover:text-gray-900"
            >
                <ArrowLeft className="w-5 h-5 mr-1" />
                Back
            </button>

            <div className="max-w-md w-full mx-auto space-y-6">
                <h1 className="text-2xl font-bold text-gray-900 text-center">
                    Paste your SMS messages
                </h1>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
                    <h2 className="font-bold text-amber-800">Important: Date limit</h2>
                    <p className="text-amber-800">
                        Only include M-PESA messages from after {formatCutoffDisplay(cutoffDate)}. 
                        Messages before this date are outside your selected period — but any messages you include will still be processed.
                    </p>
                    <p className="text-sm text-amber-600">
                        Tip: In your SMS app, scroll to {formatCutoffDisplay(cutoffDate)} and start selecting from there.
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
                    className={`w-full py-3 px-4 rounded-lg font-medium ${
                        smsText.trim() 
                            ? 'bg-[#00A651] text-white hover:bg-[#008F45]'
                            : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    }`}
                >
                    Generate {mode === 'receipt' ? 'Receipt' : 'Ledger'}
                </button>
            </div>
        </div>
    );
}
