import type { LayoutResult } from '../../lib/documentPrimitives';
import { RECEIPT_FONT_FAMILY } from '../../lib/receipt/fonts';
import { PrimitivesView } from '../PrimitivesView';

// Thin receipt-specific wrapper around the shared PrimitivesView (also used
// by the day card) — supplies the receipt's own font map and the
// data-receipt-preview hook the e2e suite targets.

interface ReceiptPrimitivesViewProps {
    layout: LayoutResult;
    displayWidth: number;
}

export function ReceiptPrimitivesView({ layout, displayWidth }: ReceiptPrimitivesViewProps) {
    return (
        <PrimitivesView
            layout={layout}
            fontFamily={RECEIPT_FONT_FAMILY}
            displayWidth={displayWidth}
            outerProps={{ 'data-receipt-preview': true } as React.HTMLAttributes<HTMLDivElement>}
        />
    );
}
