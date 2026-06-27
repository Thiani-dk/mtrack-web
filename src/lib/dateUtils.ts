import type { TimeRange } from '../types';

export function roundToNearestHour(date: Date): Date {
    const rounded = new Date(date);
    if (rounded.getMinutes() >= 30) {
        rounded.setHours(rounded.getHours() + 1);
    }
    rounded.setMinutes(0, 0, 0);
    return rounded;
}

export function getCutoffDate(range: TimeRange): Date {
    const now = new Date();
    let days = 0;
    
    switch (range) {
        case 'week': days = 7; break;
        case 'month': days = 30; break;
        case '3months': days = 90; break;
        case '6months': days = 180; break;
        case 'year': days = 365; break;
    }

    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    return roundToNearestHour(cutoff);
}

export function formatCutoffDisplay(date: Date): string {
    const dateStr = date.toLocaleDateString('en-US', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
    const timeStr = date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
    return `${dateStr} at ${timeStr}`;
}

export function getDaysLabel(range: TimeRange): string {
    switch (range) {
        case 'week': return 'past 7 days';
        case 'month': return 'past 30 days';
        case '3months': return 'past 90 days';
        case '6months': return 'past 180 days';
        case 'year': return 'past 365 days';
    }
}
