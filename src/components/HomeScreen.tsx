import { FileText, Table2 } from 'lucide-react';

interface HomeScreenProps {
    onSelect: (mode: 'receipt' | 'ledger') => void;
}

export function HomeScreen({ onSelect }: HomeScreenProps) {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="max-w-md w-full space-y-8">
                <div className="text-center">
                    <h1 className="text-3xl font-bold text-gray-900">
                        M-Track <span className="text-[#00A651]"></span>
                    </h1>
                    <p className="mt-2 text-gray-600">
                        What would you like to do?
                    </p>
                </div>

                <div className="space-y-4">
                    <button
                        onClick={() => onSelect('receipt')}
                        className="flex items-center w-full min-h-[120px] p-6 space-x-4 text-left bg-white border border-gray-200 rounded-lg hover:border-[#00A651] hover:shadow-md transition-all"
                    >
                        <FileText className="w-8 h-8 text-[#00A651]" />
                        <div>
                            <h2 className="text-lg font-medium text-gray-900">Generate Reimbursement Receipt</h2>
                            <p className="text-sm text-gray-500">
                                Export a professional receipt from your M-PESA messages
                            </p>
                        </div>
                    </button>

                    <button
                        onClick={() => onSelect('ledger')}
                        className="flex items-center w-full min-h-[120px] p-6 space-x-4 text-left bg-white border border-gray-200 rounded-lg hover:border-[#00A651] hover:shadow-md transition-all"
                    >
                        <Table2 className="w-8 h-8 text-[#00A651]" />
                        <div>
                            <h2 className="text-lg font-medium text-gray-900">Organise KRA Ledger</h2>
                            <p className="text-sm text-gray-500">
                                Create a daily/monthly CSV ledger for KRA records
                            </p>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}
