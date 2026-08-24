import { useEffect, useState } from 'react';
import type { AppStep } from './types';
import { HomeScreen } from './components/HomeScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { AllTimeScreen } from './components/AllTimeScreen';
import { BadgesScreen } from './components/BadgesScreen';
import { ChatScreen } from './components/chat/ChatScreen';

export default function App() {
    // ── Share target handler ─────────────────────────────────────────────────
    // When the PWA is opened via Android Share, the OS appends
    // ?text=<shared content> to /share-target. Shared text lands directly in
    // the chat flow's parse step and gets auto-submitted there.

    const [sharedText] = useState<string | null>(() => {
        const params = new URLSearchParams(window.location.search);
        const text = params.get('text') ?? params.get('title') ?? null;
        return text && text.trim().length > 0 ? text.trim() : null;
    });

    const [step, setStep] = useState<AppStep>(() => (sharedText ? 'chat' : 'home'));
    const [chatDemoMode, setChatDemoMode] = useState(false);

    useEffect(() => {
        if (sharedText) {
            // Clean the URL so refresh doesn't re-trigger
            window.history.replaceState({}, '', '/');
        }
    }, [sharedText]);

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
                        initialSharedText={sharedText}
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
