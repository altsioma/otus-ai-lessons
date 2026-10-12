/** Everything a tool implementation needs from the environment; injected so tests can use temp roots. */
export interface ToolContext {
    projectRoot: string;
    docsRoot: string;
    checkTimeoutMs: number;
}
