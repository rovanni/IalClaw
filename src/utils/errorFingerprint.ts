export function normalizeError(error: string): string {
    if (!error) return 'unknown';

    return error
        .replace(/[a-zA-Z_$][a-zA-Z0-9_$]*/g, 'VAR')
        .replace(/\d+/g, 'N')
        .replace(/(\/[^\s]+)+/g, 'PATH')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
}
