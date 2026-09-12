import { join } from 'node:path';
import { launch, openActiveMode, reporter, SHOT_DIR } from './harness.mjs';

// Active Mode at the viewport sizes it actually has to work in.
//
// The premise is running beside an SMS app, which in practice means an Android
// split-screen window and often the on-screen keyboard on top of that. Reading
// the CSS is not a check: `vh` looks correct in a stylesheet and still pushes
// the paste field off a phone screen, which is precisely the failure this
// screen cannot have. So these are measured against a rendered page.
//
// At every size, the paste input, the bucket chip row, the running total and
// Finish must all be inside the viewport and reachable.

const SIZES = [
    { name: 'narrow portrait split', width: 360, height: 400 },
    { name: 'landscape split, keyboard-adjacent height loss', width: 640, height: 280 },
    { name: 'narrow split with the keyboard open', width: 360, height: 210 },
    { name: 'ordinary phone, for comparison', width: 390, height: 844 },
];

const { check, finish } = reporter();
const browser = await launch();

for (const size of SIZES) {
    const label = `${size.width}x${size.height} ${size.name}`;
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });

    await openActiveMode(page);
    // Past the first-run walkthrough to the capture screen itself.
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.count()) {
        await skip.click();
        await page.waitForTimeout(300);
    }

    // Seed enough buckets that the chip row genuinely has to scroll.
    for (const name of ['Combo sales', 'Dessert sales', 'Drinks', 'Snacks', 'Bottled water', 'Ice cream']) {
        await page.getByRole('button', { name: /New bucket/ }).click();
        await page.getByPlaceholder('Bucket name').fill(name);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(60);
    }

    const m = await page.evaluate(({ w, h }) => {
        const box = el => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {
                top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
                left: +r.left.toFixed(1), right: +r.right.toFixed(1),
                w: +r.width.toFixed(1), h: +r.height.toFixed(1),
            };
        };
        const inside = b => !!b && b.h > 0 && b.w > 0
            && b.top >= -0.5 && b.bottom <= h + 0.5
            && b.left >= -0.5 && b.right <= w + 0.5;

        const chips = document.querySelector('.am-chips');
        const finishBtn = [...document.querySelectorAll('button')]
            .find(b => b.textContent.trim() === 'Finish');

        // Scroll the chip row to its end: the last chip must be fully clear of
        // the container edge, not half-cut.
        let lastChipClear = null;
        let scrollable = null;
        if (chips) {
            chips.scrollLeft = chips.scrollWidth;
            scrollable = chips.scrollWidth > chips.clientWidth;
            const kids = [...chips.children];
            const last = kids[kids.length - 1];
            lastChipClear = last
                ? last.getBoundingClientRect().right <= chips.getBoundingClientRect().right + 0.5
                : null;
            chips.scrollLeft = 0;
        }

        return {
            rootHeight: box(document.querySelector('.active-mode'))?.h,
            overflowsViewport: document.documentElement.scrollHeight > h + 1,
            input: inside(box(document.querySelector('.am-input'))),
            chips: inside(box(chips)),
            total: inside(box(document.querySelector('.am-total'))),
            finish: inside(box(finishBtn)),
            totalText: document.querySelector('.am-total')?.textContent?.trim(),
            chipWrap: chips ? getComputedStyle(chips).flexWrap : null,
            chipCount: chips ? chips.children.length : 0,
            scrollable,
            lastChipClear,
        };
    }, { w: size.width, h: size.height });

    check(`${label}: paste field, chips, total and Finish all on screen`,
        m.input && m.chips && m.total && m.finish && !m.overflowsViewport,
        JSON.stringify(m));

    // dvh sizing means the container tracks the viewport exactly. A container
    // taller than the viewport is the clipping this whole phase is about.
    check(`${label}: container height tracks the viewport, nothing clipped`,
        Math.abs(m.rootHeight - size.height) < 1,
        `container ${m.rootHeight} vs viewport ${size.height}`);

    check(`${label}: chip row scrolls sideways rather than wrapping`,
        m.chipWrap === 'nowrap' && m.scrollable === true && m.lastChipClear === true,
        `wrap=${m.chipWrap} scrollable=${m.scrollable} lastChipClear=${m.lastChipClear} chips=${m.chipCount}`);

    await page.screenshot({ path: join(SHOT_DIR, `viewport-${size.width}x${size.height}.png`) });
    await page.close();
}

await browser.close();
console.log(`\nScreenshots: ${SHOT_DIR}`);
finish();
