// Three-tier share: native file share -> native text share -> clipboard.
// Every tier is optional-chained since Web Share (and especially file
// sharing via canShare) isn't universally available.

export type ShareResult = 'shared' | 'copied' | 'failed';

interface ShareFile {
    blob: Blob;
    filename: string;
    mimeType: string;
}

interface ShareInput {
    file?: ShareFile;
    title: string;
    text: string;
}

function isAbort(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError';
}

export async function share({ file, title, text }: ShareInput): Promise<ShareResult> {
    const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
    };

    if (file && nav.canShare && nav.share) {
        const shareFile = new File([file.blob], file.filename, { type: file.mimeType });
        if (nav.canShare({ files: [shareFile] })) {
            try {
                await nav.share({ files: [shareFile], title, text });
                return 'shared';
            } catch (err) {
                if (isAbort(err)) return 'shared';
                // Fall through to the next tier
            }
        }
    }

    if (nav.share) {
        try {
            await nav.share({ title, text });
            return 'shared';
        } catch (err) {
            if (isAbort(err)) return 'shared';
        }
    }

    try {
        await navigator.clipboard.writeText(text);
        return 'copied';
    } catch {
        return 'failed';
    }
}
