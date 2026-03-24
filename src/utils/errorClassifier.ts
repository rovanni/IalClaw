export function classifyError(error: string): string {
    if (!error) return 'unknown';

    if (error.includes('Unexpected token')) return 'syntax';
    if (error.includes('is not defined')) return 'reference';
    if (error.includes('Cannot read')) return 'null_access';
    if (error.includes('not a function')) return 'type_error';
    if (error.includes('Failed to fetch')) return 'network';

    return 'unknown';
}
