import { useEffect, useState } from 'react';
import type { AppStep } from './types';
import { getAllSessions } from './lib/chatSessionStore';
import { HomeScreen } from './components/HomeScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { AllTimeScreen } from './components/AllTimeScreen';
import { BadgesScreen } from './components/BadgesScreen';
import { ChatScreen } from './components/chat/ChatScreen';

export default function App() {
    // Route resolution: on mount, check for a session still 'awaiting_input'
    // (created, greeted, composer never used) — if one exists, skip
    // HomeScreen and drop straight back into that conversation instead of
    // making the user re-navigate to something they already started.
    // `step` stays null (renders nothing) for the brief IndexedDB read so
    // HomeScreen never flashes before the redirect.
    const [step, setStep] = useState<AppStep | null>(null);
    const [chatDemoMode, setChatDemoMode] = useState(false);
    const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const sessions = await getAllSessions();
                const awaiting = sessions.find(s => s.sessionStatus === 'awaiting_input');
                if (awaiting) {
                    setResumeSessionId(awaiting.id);
                    setStep('chat');
                    return;
                }
            } catch {
                // IndexedDB unavailable — fall through to the normal home route.
            }
            setStep('home');
        })();
    }, []);

    const handleHomeSelect = () => {
        setChatDemoMode(false);
        // An explicit "start a summary" click always begins fresh — the
        // auto-resume above only applies to the initial app-mount check.
        setResumeSessionId(null);
        setStep('chat');
    };

    const handleDemoSelect = () => {
        setChatDemoMode(true);
        setResumeSessionId(null);
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
                        resumeSessionId={resumeSessionId}
                        onBack={() => {
                            setChatDemoMode(false);
                            setResumeSessionId(null);
                            setStep('home');
                        }}
                    />
                );

            default:
                return null;
        }
    };

    if (step === null) {
        return <div className="min-h-screen bg-[var(--bg-base)]" />;
    }

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
