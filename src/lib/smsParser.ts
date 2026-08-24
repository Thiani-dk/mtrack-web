// Re-export shim — the real parsing engine lives in ./parsers (a modular
// field-extraction pipeline, not per-bank parsers). Kept so existing imports
// of `parseAllSMS` from this path keep working.
export { parseAllSMS } from './parsers';
