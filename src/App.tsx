import { useState } from 'react';
import type { AppStep } from './types';
import { HomeScreen } from './components/HomeScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { AllTimeScreen } from './components/AllTimeScreen';
import { BadgesScreen } from './components/BadgesScreen';
import { ChatScreen } from './components/chat/ChatScreen';

export default function App() {
    const [step, setStep] = useState<AppStep>('home');
    const [chatDemoMode, setChatDemoMode] = useState(false);

    const handleHomeSelect = () => {
        setChatDemoMode(false);
        setStep('chat');
    };

    const handleDemoSelect = () => {
        setChatDemoMode(true);
        setStep('chat');
    };

    const renderStep = () => {
        switch (step) {
            case 'home':
                return (
                    <HomeScreen
                        onSelect={handleHomeSelect}
                        onDemoClick={handleDemoSelect}
                        onHistoryClick={() => setStep('history')}
                        onAllTimeClick={() => setStep('allTime')}
                    />
                );

            case 'history':
                return (
                    <HistoryScreen
                        onBack={() => setStep('home')}
                        onDemoClick={handleDemoSelect}
                    />
                );

            case 'allTime':
                return (
                    <AllTimeScreen
                        onBack={() => setStep('home')}
                        onBadgesClick={() => setStep('badges')}
                    />
                );

            case 'badges':
                return (
                    <BadgesScreen onBack={() => setStep('allTime')} />
                );

            case 'chat':
                return (
                    <ChatScreen
                        demoMode={chatDemoMode}
                        onBack={() => {
                            setChatDemoMode(false);
                            setStep('home');
                        }}
                    />
                );

            default:
                return null;
        }
    };

    // The chat screen owns a full-width, two-column desktop layout — it opts
    // out of the max-w-lg phone-frame wrapper the other screens share.
    if (step === 'chat') {
        return (
            <div className="min-h-screen bg-[var(--bg-base)]">
                {renderStep()}
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--bg-base)]">
            <div className="max-w-lg mx-auto min-h-screen">
                {renderStep()}
            </div>
        </div>
    );
}
