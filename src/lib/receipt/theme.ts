// The receipt's own fixed palette — unlike the day card, there is no
// light/dark toggle here. A receipt looks like paper: warm white paper on a
// slightly darker surface behind it (so the torn edges actually read as torn,
// against something), black-ish ink. That's what it always looks like, on
// screen or printed, so there is nothing to switch.
export const RECEIPT_PALETTE = {
    page: '#E7E4DA',
    paper: '#FDFDF8',
    ink: '#1C1B17',
    muted: '#6E6A5E',
    divider: '#C9C5B7',
};
