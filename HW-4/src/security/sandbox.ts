import { constants } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ToolError } from '../errors.ts';

// File access policy for every tool. A path is usable only if:
//  1. it is relative, has no NUL bytes and stays inside the root after normalization (blocks "../");
//  2. no segment of it is on the deny list (.env, .git, node_modules, keys, ...);
//  3. its real path (symlinks resolved) is still inside the root and not denied;
//  4. when read, the opened descriptor (O_NOFOLLOW) is the same regular file that was checked.
// Error messages quote only the path the caller supplied, never file contents or outside paths.

export const LIMITS = {
    maxFileBytes: 256 * 1024,
    maxFilesScanned: 2000,
    maxDepth: 12
} as const;

const DENIED_DIRECTORIES = new Set(['.git', 'node_modules', '.ssh', '.aws', '.gnupg', '.docker', '.kube']);
const DENIED_NAMES: RegExp[] = [
    /^\.env$/i,
    /^\.env\.(?!example$).+$/i,
    /\.(pem|key|p12|pfx|jks|keystore|crt|cer)$/i,
    /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
    /^\.(npmrc|netrc|pgpass|git-credentials)$/i,
    /^credentials(\.json)?$/i,
    /^secrets?(\.(json|ya?ml|toml|env|txt|ini))?$/i
];

export interface SafePath {
    /** Real absolute path inside the root. */
    absolute: string;
    /** Path relative to the root with "/" separators ("." for the root itself). */
    relative: string;
}

export function isDenied(relativePath: string): boolean {
    return relativePath
        .split(/[\\/]+/)
        .filter(segment => segment !== '' && segment !== '.')
        .some(segment => DENIED_DIRECTORIES.has(segment) || DENIED_NAMES.some(pattern => pattern.test(segment)));
}

export function isInside(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function toPosix(relative: string): string {
    return relative === '' ? '.' : relative.split(path.sep).join('/');
}

/** Resolves a caller-supplied relative path inside `root` (which must itself be a real path). */
export async function resolveSafePath(root: string, requested: string): Promise<SafePath> {
    if (requested.includes('\0')) throw new ToolError('INVALID_INPUT', 'Path must not contain NUL bytes');
    if (path.isAbsolute(requested) || /^[a-zA-Z]:/.test(requested)) {
        throw new ToolError('PATH_OUTSIDE_ROOT', `Absolute paths are not allowed: "${requested}". Use a path relative to the root.`);
    }

    const lexical = path.resolve(root, requested);
    if (!isInside(root, lexical)) throw new ToolError('PATH_OUTSIDE_ROOT', `Path "${requested}" points outside the allowed directory`);
    if (isDenied(path.relative(root, lexical))) throw new ToolError('ACCESS_DENIED', `Access to "${requested}" is denied by policy`);

    let real: string;
    try {
        real = await realpath(lexical);
    } catch (error) {
        throw fsError(error, requested);
    }
    if (!isInside(root, real)) throw new ToolError('PATH_OUTSIDE_ROOT', `Path "${requested}" resolves outside the allowed directory`);
    const relative = path.relative(root, real);
    if (isDenied(relative)) throw new ToolError('ACCESS_DENIED', `Access to "${requested}" is denied by policy`);

    return { absolute: real, relative: toPosix(relative) };
}

export interface TextFile extends SafePath {
    text: string;
}

/** Reads a UTF-8 text file inside `root` after the full policy check. */
export async function readTextFileSafe(root: string, requested: string, maxBytes: number = LIMITS.maxFileBytes): Promise<TextFile> {
    const target = await resolveSafePath(root, requested);

    let handle;
    try {
        // O_NOFOLLOW: if the checked path was swapped for a symlink after realpath(), open fails.
        handle = await open(target.absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
        throw fsError(error, requested);
    }
    try {
        const opened = await handle.stat();
        if (!opened.isFile()) throw new ToolError('NOT_A_FILE', `"${requested}" is not a regular file`);
        if (opened.size > maxBytes) throw new ToolError('FILE_TOO_LARGE', `"${requested}" is larger than ${maxBytes} bytes`);

        // The descriptor must still be the file we validated (guards against swaps between check and open).
        const current = await stat(target.absolute).catch(() => undefined);
        if (!current || current.ino !== opened.ino || current.dev !== opened.dev) {
            throw new ToolError('ACCESS_DENIED', `"${requested}" changed while it was being opened`);
        }

        const buffer = await handle.readFile();
        if (buffer.length > maxBytes) throw new ToolError('FILE_TOO_LARGE', `"${requested}" is larger than ${maxBytes} bytes`);
        if (buffer.includes(0)) throw new ToolError('UNSUPPORTED_FILE_TYPE', `"${requested}" looks like a binary file`);
        return { ...target, text: buffer.toString('utf8') };
    } finally {
        await handle.close();
    }
}

export interface WalkOptions {
    extensions: readonly string[];
    maxFiles?: number;
}

export interface WalkResult {
    files: SafePath[];
    /** True when the scan stopped at maxFiles. */
    truncated: boolean;
}

/**
 * Lists files under `start` (a file or directory relative to `root`) in a stable order.
 * Denied entries are skipped silently; symlinks are followed only to files that pass resolveSafePath,
 * symlinked directories are never descended.
 */
export async function walkFiles(root: string, start: string, options: WalkOptions): Promise<WalkResult> {
    const maxFiles = options.maxFiles ?? LIMITS.maxFilesScanned;
    const wanted = (file: string) => options.extensions.includes(path.extname(file).toLowerCase());
    const origin = await resolveSafePath(root, start);
    const originStat = await stat(origin.absolute);

    if (originStat.isFile()) return { files: wanted(origin.absolute) ? [origin] : [], truncated: false };
    if (!originStat.isDirectory()) throw new ToolError('NOT_A_FILE', `"${start}" is neither a file nor a directory`);

    const files: SafePath[] = [];
    const queue: Array<{ relative: string; depth: number }> = [{ relative: origin.relative, depth: 0 }];

    while (queue.length > 0) {
        const { relative, depth } = queue.shift()!;
        const entries = await readdir(path.join(root, relative), { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
            const childRelative = relative === '.' ? entry.name : `${relative}/${entry.name}`;
            if (isDenied(childRelative)) continue;

            if (entry.isDirectory()) {
                if (depth + 1 < LIMITS.maxDepth) queue.push({ relative: childRelative, depth: depth + 1 });
                continue;
            }

            let candidate: SafePath;
            if (entry.isSymbolicLink()) {
                try {
                    candidate = await resolveSafePath(root, childRelative);
                    if (!(await stat(candidate.absolute)).isFile()) continue;
                } catch {
                    continue; // escapes the root, denied or dangling
                }
            } else if (entry.isFile()) {
                candidate = { absolute: path.join(root, childRelative), relative: childRelative };
            } else {
                continue;
            }

            if (!wanted(candidate.relative)) continue;
            if (files.length >= maxFiles) return { files, truncated: true };
            files.push(candidate);
        }
    }
    return { files, truncated: false };
}

function fsError(error: unknown, requested: string): ToolError {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    switch (code) {
        case 'ENOENT':
        case 'ENOTDIR':
            return new ToolError('NOT_FOUND', `"${requested}" does not exist`);
        case 'ELOOP':
            return new ToolError('ACCESS_DENIED', `"${requested}" is a symbolic link that cannot be followed`);
        case 'EACCES':
        case 'EPERM':
            return new ToolError('ACCESS_DENIED', `"${requested}" is not readable`);
        case 'EISDIR':
            return new ToolError('NOT_A_FILE', `"${requested}" is a directory`);
        default:
            return new ToolError('INTERNAL_ERROR', `Could not access "${requested}"`);
    }
}
