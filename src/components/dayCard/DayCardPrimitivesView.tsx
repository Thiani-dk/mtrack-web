import type { CSSProperties } from 'react';
import type { LayoutResult, Primitive } from '../../lib/dayCard/primitives';
import { DAY_CARD_FONT_FAMILY } from '../../lib/dayCard/fonts';

// The in-app backend: draws the exact same positioned primitives the canvas
// PNG backend draws (renderPng.ts), as absolutely-positioned DOM nodes rather
// than canvas draw calls. Owns no layout decisions — every position, size and
// colour here came from the shared layout, scaled uniformly to fit the
// screen. See primitives.ts for why this split exists.

interface DayCardPrimitivesViewProps {
    layout: LayoutResult;
    // The on-screen width this card should occupy. The primitives are always
    // computed at the export's own design width (see layout.ts's CARD_WIDTH)
    // and scaled down uniformly to fit here, so a scaled-down preview and the
    // full-size exported PNG are guaranteed to agree on every line break and
    // every shrink decision.
    displayWidth: number;
}

function primitiveStyle(p: Primitive): CSSProperties {
    if (p.kind === 'rect') {
        return {
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: p.width,
            height: p.height,
            background: p.color,
            borderRadius: p.radius ?? 0,
        };
    }
    const originShift = p.align === 'center' ? 'translateX(-50%)' : p.align === 'right' ? 'translateX(-100%)' : undefined;
    return {
        position: 'absolute',
        left: p.x,
        top: p.y,
        transform: originShift,
        fontFamily: `'${DAY_CARD_FONT_FAMILY[p.font]}'`,
        fontSize: p.size,
        fontWeight: p.weight,
        color: p.color,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        letterSpacing: p.letterSpacing ? `${p.letterSpacing}em` : undefined,
    };
}

export function DayCardPrimitivesView({ layout, displayWidth }: DayCardPrimitivesViewProps) {
    const scale = displayWidth / layout.width;
    return (
        <div
            data-day-card-preview
            style={{
                width: displayWidth,
                height: layout.height * scale,
                position: 'relative',
                overflow: 'hidden',
                background: layout.background,
                borderRadius: 24,
            }}
        >
            <div
                style={{
                    width: layout.width,
                    height: layout.height,
                    position: 'relative',
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    background: layout.background,
                }}
            >
                {layout.primitives.map((p, i) => (
                    <div key={i} data-primitive={p.kind} style={primitiveStyle(p)}>
                        {p.kind === 'text' ? p.text : null}
                    </div>
                ))}
            </div>
        </div>
    );
}
