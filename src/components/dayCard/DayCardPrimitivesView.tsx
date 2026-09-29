import type { LayoutResult } from '../../lib/documentPrimitives';
import { DAY_CARD_FONT_FAMILY } from '../../lib/dayCard/fonts';
import { PrimitivesView } from '../PrimitivesView';

// Thin day-card-specific wrapper around the shared PrimitivesView (used by
// the receipt too) — supplies the day card's own font map and the
// data-day-card-preview hook the e2e suite already targets, directly on the
// background-carrying element (not a wrapper) so a theme-colour check on it
// reads the real value.

interface DayCardPrimitivesViewProps {
    layout: LayoutResult;
    displayWidth: number;
}

export function DayCardPrimitivesView({ layout, displayWidth }: DayCardPrimitivesViewProps) {
    return (
        <PrimitivesView
            layout={layout}
            fontFamily={DAY_CARD_FONT_FAMILY}
            displayWidth={displayWidth}
            borderRadius={24}
            outerProps={{ 'data-day-card-preview': true } as React.HTMLAttributes<HTMLDivElement>}
        />
    );
}
