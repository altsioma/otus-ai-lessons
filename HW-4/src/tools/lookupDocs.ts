import type { LookupDocsInput, LookupDocsOutput } from '../contracts.ts';
import { ToolError } from '../errors.ts';
import { readTextFileSafe, walkFiles } from '../security/sandbox.ts';
import type { ToolContext } from './context.ts';

// Deterministic keyword search over Markdown sections. No network, no embeddings.
// Words are reduced to a short prefix "stem" so that Russian/English word forms match
// ("округляются" ~ "округление", "discounts" ~ "discount").

const MAX_EXCERPT = 600;
const HEADING_WEIGHT = 3;
const BODY_HIT_CAP = 3;

const STOP_WORDS = new Set([
    'и', 'в', 'во', 'на', 'по', 'с', 'со', 'к', 'о', 'об', 'от', 'до', 'для', 'из', 'за', 'как', 'что', 'это', 'ли', 'не',
    'а', 'или', 'же', 'у', 'при', 'наш', 'наша', 'наши', 'нашей', 'нашем', 'документации', 'документация', 'проекте', 'проект',
    'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'and', 'or', 'is', 'are', 'how', 'what', 'do', 'does', 'our', 'with', 'by'
]);

interface Section {
    source: string;
    heading: string;
    headingPath: string;
    lineStart: number;
    lineEnd: number;
    body: string;
}

export function stem(word: string): string {
    if (word.length <= 3) return word;
    if (word.length <= 5) return word.slice(0, word.length - 1);
    return word.slice(0, 5);
}

export function terms(text: string): string[] {
    const words = text.toLowerCase().replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu) ?? [];
    return [...new Set(words.filter(word => word.length >= 2 && !STOP_WORDS.has(word)).map(stem))];
}

function stemsOf(text: string): string[] {
    return (text.toLowerCase().replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu) ?? []).map(stem);
}

export function parseSections(source: string, text: string): Section[] {
    const lines = text.split(/\r?\n/);
    const sections: Section[] = [];
    const stack: Array<{ level: number; title: string }> = [];
    let current: { heading: string; headingPath: string; lineStart: number; body: string[] } | undefined;
    let inFence = false;

    const flush = (lineEnd: number) => {
        if (current) sections.push({ source, ...current, lineEnd, body: current.body.join('\n').trim() });
    };

    lines.forEach((line, index) => {
        if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
        const heading = inFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (!heading) {
            current?.body.push(line);
            return;
        }
        flush(index); // previous section ends on the line before this heading
        const level = heading[1]!.length;
        const title = heading[2]!;
        while (stack.length > 0 && stack.at(-1)!.level >= level) stack.pop();
        stack.push({ level, title });
        current = { heading: title, headingPath: stack.map(entry => entry.title).join(' > '), lineStart: index + 1, body: [] };
    });
    flush(lines.at(-1) === '' ? lines.length - 1 : lines.length);
    return sections;
}

function score(section: Section, searchTerms: string[]): number {
    const headingStems = new Set(stemsOf(section.headingPath));
    const bodyStems = stemsOf(section.body);
    let total = 0;
    for (const term of searchTerms) {
        if (headingStems.has(term)) total += HEADING_WEIGHT;
        total += Math.min(BODY_HIT_CAP, bodyStems.filter(candidate => candidate === term).length);
    }
    return total;
}

export async function lookupDocs(input: LookupDocsInput, ctx: ToolContext): Promise<LookupDocsOutput> {
    const searchTerms = terms(input.topic);
    if (searchTerms.length === 0) throw new ToolError('INVALID_INPUT', 'Topic has no searchable words');

    const { files } = await walkFiles(ctx.docsRoot, '.', { extensions: ['.md'] });
    const sections: Section[] = [];
    for (const file of files) {
        const { text } = await readTextFileSafe(ctx.docsRoot, file.relative);
        sections.push(...parseSections(file.relative, text));
    }

    const results = sections
        .map(section => ({ section, score: score(section, searchTerms) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.section.source.localeCompare(b.section.source) || a.section.lineStart - b.section.lineStart)
        .slice(0, input.maxSections)
        .map(({ section, score: points }) => ({
            source: section.source,
            heading: section.heading,
            headingPath: section.headingPath,
            lineStart: section.lineStart,
            lineEnd: section.lineEnd,
            excerpt: section.body.length > MAX_EXCERPT ? `${section.body.slice(0, MAX_EXCERPT)}…` : section.body,
            score: points
        }));

    return { topic: input.topic, terms: searchTerms, results, documentsSearched: files.length, sectionsSearched: sections.length };
}
