export class CoreError extends Error {
    code;
    statusCode;
    details;
    constructor(code, message, statusCode, details) {
        super(message);
        this.name = 'CoreError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}
export function isCoreError(error) {
    return error instanceof CoreError;
}
//# sourceMappingURL=errors.js.map