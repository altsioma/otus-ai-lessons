import type { SearchCodeInput, SearchCodeOutput } from '../contracts.ts';
import { ToolError } from '../errors.ts';
import { readTextFileSafe, walkFiles } from '../security/sandbox.ts';
import type { ToolContext } from './context.ts';

const MAX_LINE_TEXT = 200;

/** Literal (non-regex) search, one match per line, files in stable path order. */
export async function searchCode(input: SearchCodeInput, ctx: ToolContext): Promise<SearchCodeOutput> {
    const extensions = input.extensions.map(extension => extension.toLowerCase());
    const { files, truncated: scanTruncated } = await walkFiles(ctx.projectRoot, input.path, { extensions });
    const needle = input.caseSensitive ? input.query : input.query.toLowerCase();

    const matches: SearchCodeOutput['matches'] = [];
    let totalMatches = 0;
    let filesScanned = 0;
    let filesSkipped = 0;

    for (const file of files) {
        let text: string;
        try {
            ({ text } = await readTextFileSafe(ctx.projectRoot, file.relative));
        } catch (error) {
            if (error instanceof ToolError && ['FILE_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE'].includes(error.code)) {
                filesSkipped += 1;
                continue;
            }
            throw error;
        }
        filesScanned += 1;

        const lines = text.split(/\r?\n/);
        lines.forEach((line, index) => {
            const column = (input.caseSensitive ? line : line.toLowerCase()).indexOf(needle);
            if (column === -1) return;
            totalMatches += 1;
            if (matches.length < input.maxResults) {
                const trimmed = line.trim();
                matches.push({
                    file: file.relative,
                    line: index + 1,
                    column: column + 1,
                    text: trimmed.length > MAX_LINE_TEXT ? `${trimmed.slice(0, MAX_LINE_TEXT)}…` : trimmed
                });
            }
        });
    }

    return {
        query: input.query,
        path: input.path,
        matches,
        totalMatches,
        filesScanned,
        filesSkipped,
        truncated: scanTruncated || totalMatches > matches.length
    };
}
