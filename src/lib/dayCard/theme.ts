// The day card's two palettes. Deliberately monochrome — one ink colour, one
// muted colour, one fill colour per theme, no accent hue — because the spec
// calls for a dark, quiet card, not a coloured chart. Both the canvas and
// in-app backends import this rather than hard-coding hex values of their
// own, so switching the preview's theme can never leave the two disagreeing.

export type DayCardTheme = 'dark' | 'light';

export interface DayCardPalette {
    background: string;
    ink: string;
    muted: string;
    tileBackground: string;
    track: string;
    fill: string;
}

export const DAY_CARD_PALETTES: Record<DayCardTheme, DayCardPalette> = {
    dark: {
        background: '#121212',
        ink: '#F5F3EE',
        muted: '#ACA79D',
        tileBackground: '#1D1C1A',
        track: '#302E2A',
        fill: '#F5F3EE',
    },
    light: {
        background: '#F5F3EE',
        ink: '#14130F',
        muted: '#5B564C',
        tileBackground: '#E9E5DB',
        track: '#D6D1C3',
        fill: '#14130F',
    },
};
