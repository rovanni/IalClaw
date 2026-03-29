export function normalizeError(error: string): string {
    if (!error) return 'unknown';

    const normalized = error
        .replace(/[a-zA-Z_$][a-zA-Z0-9_$]*/g, 'VAR')
        .replace(/\d+/g, 'N')
        .replace(/(\/[^\s]+)+/g, 'PATH')
        .replace(/\s+/g, ' ')
        .trim();

    const truncated = normalized.slice(0, 200);
    const safe = truncated.substring(0, truncated.lastIndexOf(' '));

    return safe || truncated;
}
