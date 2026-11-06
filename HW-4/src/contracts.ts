import * as z from 'zod';

// Single source of truth for tool names, input/output schemas and error codes.
// docs/contract.md documents the same shapes; tests/contracts.test.ts keeps them in sync.

export const ERROR_CODES = [
    'INVALID_INPUT',
    'PATH_OUTSIDE_ROOT',
    'ACCESS_DENIED',
    'NOT_FOUND',
    'NOT_A_FILE',
    'FILE_TOO_LARGE',
    'UNSUPPORTED_FILE_TYPE',
    'CHECK_NOT_ALLOWED',
    'TIMEOUT',
    'EXECUTION_FAILED',
    'INTERNAL_ERROR'
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** structuredContent of every result with `isError: true` produced by a tool handler. */
export const toolErrorSchema = z.strictObject({
    error: z.strictObject({
        code: errorCodeSchema,
        message: z.string()
    })
});
export type ToolErrorPayload = z.infer<typeof toolErrorSchema>;

const relativePath = z
    .string()
    .min(1)
    .max(300)
    .refine(value => !value.includes('\0'), 'must not contain NUL bytes');

const positiveInt = z.number().int().min(1);
const nonNegativeInt = z.number().int().min(0);

// ---------- search_code ----------

export const searchCodeInput = z.strictObject({
    query: z.string().min(1).max(200).describe('Literal text to find (not a regular expression).'),
    path: relativePath
        .default('.')
        .describe('Directory or file to search, relative to the demo project root. Defaults to the whole project.'),
    extensions: z
        .array(z.string().regex(/^\.[a-z0-9]{1,10}$/, 'must look like ".ts"'))
        .min(1)
        .max(10)
        .default(['.ts', '.tsx', '.js', '.mjs', '.json', '.md'])
        .describe('File extensions to include.'),
    caseSensitive: z.boolean().default(false).describe('Match letter case exactly.'),
    maxResults: z.number().int().min(1).max(100).default(20).describe('Maximum number of matches to return.')
});

export const searchCodeOutput = z.strictObject({
    query: z.string(),
    path: z.string().describe('Searched path, relative to the project root.'),
    matches: z.array(
        z.strictObject({
            file: z.string().describe('File path relative to the project root, with "/" separators.'),
            line: positiveInt,
            column: positiveInt,
            text: z.string().describe('The matching line, trimmed and cut to 200 characters.')
        })
    ),
    totalMatches: nonNegativeInt.describe('Matching lines found in scanned files (one match per line).'),
    filesScanned: nonNegativeInt,
    filesSkipped: nonNegativeInt.describe('Files skipped because they are too large or binary.'),
    truncated: z.boolean().describe('True if matches were cut to maxResults or the file scan limit was hit.')
});

// ---------- get_file_outline ----------

export const EXPORT_KINDS = ['function', 'class', 'interface', 'type', 'enum', 'variable', 'namespace', 're-export', 'default'] as const;
export const MEMBER_KINDS = ['constructor', 'method', 'property', 'getter', 'setter'] as const;

export const getFileOutlineInput = z.strictObject({
    path: relativePath.describe('TypeScript file (.ts, .tsx, .mts, .cts) relative to the demo project root.')
});

const outlineMember = z.strictObject({
    name: z.string(),
    kind: z.enum(MEMBER_KINDS),
    line: positiveInt,
    signature: z.string(),
    isStatic: z.boolean()
});

export const getFileOutlineOutput = z.strictObject({
    file: z.string(),
    exports: z.array(
        z.strictObject({
            name: z.string().describe('Exported name; "default" for default exports, "*" for `export *`.'),
            kind: z.enum(EXPORT_KINDS),
            line: positiveInt,
            signature: z.string().describe('Declaration without bodies or initializer details.'),
            isDefault: z.boolean(),
            jsDoc: z.string().nullable(),
            members: z.array(outlineMember).describe('Public members of classes and interfaces; empty otherwise.')
        })
    ),
    totalExports: nonNegativeInt
});

// ---------- lookup_docs ----------

export const lookupDocsInput = z.strictObject({
    topic: z.string().min(2).max(200).describe('What to look up, in words (Russian or English).'),
    maxSections: z.number().int().min(1).max(5).default(3).describe('Maximum number of sections to return.')
});

export const lookupDocsOutput = z.strictObject({
    topic: z.string(),
    terms: z.array(z.string()).describe('Normalized search terms derived from the topic.'),
    results: z.array(
        z.strictObject({
            source: z.string().describe('Markdown file relative to the docs root.'),
            heading: z.string(),
            headingPath: z.string().describe('Parent headings joined with " > ".'),
            lineStart: positiveInt,
            lineEnd: positiveInt,
            excerpt: z.string().describe('Section text, cut to 600 characters.'),
            score: positiveInt
        })
    ),
    documentsSearched: nonNegativeInt,
    sectionsSearched: nonNegativeInt
});

// ---------- run_check ----------

export const CHECK_NAMES = ['test', 'typecheck'] as const;

export const runCheckInput = z.strictObject({
    check: z.enum(CHECK_NAMES).describe('Allowed check: "test" (node --test) or "typecheck" (tsc --noEmit).')
});

export const runCheckOutput = z.strictObject({
    check: z.enum(CHECK_NAMES),
    command: z.string().describe('Exact fixed command line that was run (for display only).'),
    exitCode: z.number().int(),
    passed: z.boolean(),
    durationMs: nonNegativeInt,
    summary: z.strictObject({
        testsPassed: nonNegativeInt.nullable(),
        testsFailed: nonNegativeInt.nullable(),
        typeErrors: nonNegativeInt.nullable()
    }),
    output: z.string().describe('Tail of combined stdout/stderr, at most 4000 characters.'),
    outputTruncated: z.boolean()
});

// ---------- tool definitions ----------

export const TOOLS = {
    searchCode: {
        name: 'search_code',
        title: 'Search code in the demo project',
        description:
            'Find literal text (e.g. a function name) in files of the local demo project and return file path, line, column and the matching line. Use it to answer "where is X used/defined".',
        inputSchema: searchCodeInput,
        outputSchema: searchCodeOutput,
        annotations: { readOnlyHint: true, openWorldHint: false }
    },
    getFileOutline: {
        name: 'get_file_outline',
        title: 'Public API of a TypeScript file',
        description:
            'Parse a TypeScript file of the local demo project with the TypeScript compiler and list its exports: name, kind, line, signature, JSDoc and public class members.',
        inputSchema: getFileOutlineInput,
        outputSchema: getFileOutlineOutput,
        annotations: { readOnlyHint: true, openWorldHint: false }
    },
    lookupDocs: {
        name: 'lookup_docs',
        title: 'Look up project documentation',
        description:
            'Search the local project knowledge base (docs-kb Markdown: price rounding, discounts, error handling, quality checks) and return the best matching sections with source file and line range.',
        inputSchema: lookupDocsInput,
        outputSchema: lookupDocsOutput,
        annotations: { readOnlyHint: true, openWorldHint: false }
    },
    runCheck: {
        name: 'run_check',
        title: 'Run an allowed check of the demo project',
        description:
            'Run one pre-approved check of the local demo project: "test" (unit tests) or "typecheck" (TypeScript). Arbitrary commands are not supported. Returns exit code, pass/fail summary and output tail.',
        inputSchema: runCheckInput,
        outputSchema: runCheckOutput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }
} as const;

export type SearchCodeInput = z.output<typeof searchCodeInput>;
export type SearchCodeOutput = z.output<typeof searchCodeOutput>;
export type GetFileOutlineInput = z.output<typeof getFileOutlineInput>;
export type GetFileOutlineOutput = z.output<typeof getFileOutlineOutput>;
export type LookupDocsInput = z.output<typeof lookupDocsInput>;
export type LookupDocsOutput = z.output<typeof lookupDocsOutput>;
export type RunCheckInput = z.output<typeof runCheckInput>;
export type RunCheckOutput = z.output<typeof runCheckOutput>;
export type CheckName = (typeof CHECK_NAMES)[number];
