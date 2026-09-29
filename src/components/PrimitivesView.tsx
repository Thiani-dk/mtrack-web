import type { CSSProperties } from 'react';
import type { FontFamily, LayoutResult, Primitive } from '../lib/documentPrimitives';

// The in-app backend, shared by every positioned-primitives document (the day
// card, the receipt): draws the exact same primitives the canvas/PDF backends
// draw, as absolutely-positioned DOM nodes. Owns no layout decisions — every
// position, size and colour here came from the shared layout, scaled
// uniformly to fit the screen.

interface PrimitivesViewProps {
    layout: LayoutResult;
    fontFamily: Record<FontFamily, string>;
    // The on-screen width this should occupy. Primitives are always computed
    // at the export's own design width and scaled down uniformly to fit here,
    // so a scaled-down preview and the full-size exported file are guaranteed
    // to agree on every line break and every shrink decision.
    displayWidth: number;
    borderRadius?: number;
    // Spread onto the outer, background-carrying element — this is the node
    // e2e checks (a data- hook, a computed-background-colour read for the
    // theme toggle) need to target, not a wrapper one level up.
    outerProps?: React.HTMLAttributes<HTMLDivElement>;
}

function zigzagClipPath(p: Extract<Primitive, { kind: 'zigzag' }>): string {
    const points = [];
    for (let i = 0; i < p.points.length; i += 2) {
        const px = ((p.points[i] - p.x) / p.width) * 100;
        const py = ((p.points[i + 1] - p.y) / p.height) * 100;
        points.push(`${px}% ${py}%`);
    }
    return `polygon(${points.join(', ')})`;
}

function primitiveNode(p: Primitive, fontFamily: Record<FontFamily, string>, key: number) {
    if (p.kind === 'rect') {
        const style: CSSProperties = {
            position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
            background: p.color, borderRadius: p.radius ?? 0,
        };
        return <div key={key} data-primitive="rect" style={style} />;
    }
    if (p.kind === 'zigzag') {
        const style: CSSProperties = {
            position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height,
            background: p.color, clipPath: zigzagClipPath(p),
        };
        return <div key={key} data-primitive="zigzag" style={style} />;
    }
    if (p.kind === 'image') {
        const style: CSSProperties = { position: 'absolute', left: p.x, top: p.y, width: p.width, height: p.height };
        return <img key={key} data-primitive="image" src={p.dataUrl} alt="" style={style} />;
    }
    const originShift = p.align === 'center' ? 'translateX(-50%)' : p.align === 'right' ? 'translateX(-100%)' : undefined;
    const style: CSSProperties = {
        position: 'absolute', left: p.x, top: p.y, transform: originShift,
        fontFamily: `'${fontFamily[p.font]}'`, fontSize: p.size, fontWeight: p.weight, color: p.color,
        lineHeight: 1, whiteSpace: 'nowrap', letterSpacing: p.letterSpacing ? `${p.letterSpacing}em` : undefined,
    };
    return <div key={key} data-primitive="text" style={style}>{p.text}</div>;
}

export function PrimitivesView({ layout, fontFamily, displayWidth, borderRadius = 0, outerProps }: PrimitivesViewProps) {
    const scale = displayWidth / layout.width;
    return (
        <div
            data-primitives-preview
            {...outerProps}
            style={{
                width: displayWidth, height: layout.height * scale, position: 'relative',
                overflow: 'hidden', background: layout.background, borderRadius,
                ...outerProps?.style,
            }}
        >
            <div
                style={{
                    width: layout.width, height: layout.height, position: 'relative',
                    transform: `scale(${scale})`, transformOrigin: 'top left', background: layout.background,
                }}
            >
                {layout.primitives.map((p, i) => primitiveNode(p, fontFamily, i))}
            </div>
        </div>
    );
}
