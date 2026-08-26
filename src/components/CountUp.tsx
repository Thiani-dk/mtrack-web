import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

interface CountUpProps {
    value: number;
    duration?: number;               // seconds
    delay?: number;                  // seconds
    format?: (n: number) => string;
    play?: boolean;                  // false renders the final value immediately, no animation
    replayKey?: number;              // bump to replay the count from 0
}

const defaultFormat = (n: number) => String(Math.round(n));

// Ease-out cubic — fast start, gentle settle, matching the spring-heavy feel
// used elsewhere in the app without depending on a motion-value driven number.
function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
}

export function CountUp({ value, duration = 0.5, delay = 0, format = defaultFormat, play = true, replayKey = 0 }: CountUpProps) {
    const reducedMotion = useReducedMotion();
    const animate = play && !reducedMotion;
    const [animatedValue, setAnimatedValue] = useState(0);
    const frameRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (!animate) return;
        let cancelled = false;
        const startTimer = setTimeout(() => {
            const startTime = performance.now();
            const step = (now: number) => {
                if (cancelled) return;
                const elapsed = (now - startTime) / 1000;
                const t = Math.min(1, duration > 0 ? elapsed / duration : 1);
                setAnimatedValue(value * easeOutCubic(t));
                if (t < 1) frameRef.current = requestAnimationFrame(step);
            };
            frameRef.current = requestAnimationFrame(step);
        }, delay * 1000);
        return () => {
            cancelled = true;
            clearTimeout(startTimer);
            if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
        };
    }, [value, duration, delay, animate, replayKey]);

    // While not animating (reduced motion, play=false, or before the first
    // frame lands), render the real value directly rather than mirroring it
    // into state — keeps the static path a pure render, no effect needed.
    const display = animate ? animatedValue : value;

    return <>{format(display)}</>;
}
