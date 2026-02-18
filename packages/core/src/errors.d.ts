export declare class CoreError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly details?: unknown;
    constructor(code: string, message: string, statusCode: number, details?: unknown);
}
export declare function isCoreError(error: unknown): error is CoreError;
//# sourceMappingURL=errors.d.ts.map