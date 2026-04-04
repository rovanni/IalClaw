import { ExecutionPlanBuilder } from '../ExecutionPlanRegistry';

export const buildFilesystemPlan: ExecutionPlanBuilder = (input: string) => {
    if (!input) {
        return null;
    }

    const targetPaths = extractFilesystemTargetPaths(input);
    return targetPaths.map(path => ({
        tool: 'create_directory',
        params: { path }
    }));
};

function extractFilesystemTargetPaths(userInput: string): string[] {
    const normalized = userInput.toLowerCase();
    const rootMatch = normalized.match(/(?:pasta|diret[óo]rio|folder)\s+([\w\-./]+)/i);
    const rootSegment = sanitizePathSegment(rootMatch?.[1]);
    const rootPath = rootSegment ? ensureWorkspaceRoot(rootSegment) : 'workspace/jogos';

    const paths: string[] = [rootPath];
    const subfolderMatches = normalized.matchAll(/subpasta\s+([\w\-./]+)/gi);

    for (const match of subfolderMatches) {
        const subSegment = sanitizePathSegment(match[1]);
        if (!subSegment) {
            continue;
        }

        paths.push(appendToRoot(rootPath, subSegment));
    }

    return Array.from(new Set(paths));
}

function sanitizePathSegment(segment: string | undefined): string | null {
    if (!segment) {
        return null;
    }

    const cleaned = segment
        .replace(/[.,;:!?]+$/g, '')
        .replace(/^[\'\"`]+|[\'\"`]+$/g, '')
        .trim();

    return cleaned.length > 0 ? cleaned : null;
}

function ensureWorkspaceRoot(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');

    if (normalized.startsWith('workspace/')) {
        return normalized;
    }

    return `workspace/${normalized}`;
}

function appendToRoot(rootPath: string, segment: string): string {
    const normalizedSegment = segment.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalizedSegment.includes('/')) {
        return ensureWorkspaceRoot(normalizedSegment);
    }

    return `${rootPath}/${normalizedSegment}`;
}
