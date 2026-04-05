import * as fs from 'fs';
import * as path from 'path';

type Severity = 'error' | 'warning';

type Issue = {
    severity: Severity;
    code: string;
    message: string;
};

type CardOccurrence = {
    id: string;
    filePath: string;
};

const strictMode = process.argv.includes('--strict');
const repoRoot = process.cwd();
const kanbanRoot = path.join(repoRoot, 'docs', 'architecture', 'kanban');
const boardFiles = [
    path.join(kanbanRoot, 'Pendente', 'problemas_criticos.md'),
    path.join(kanbanRoot, 'Pendente', 'problemas_medios.md'),
    path.join(kanbanRoot, 'Pendente', 'problemas_baixos.md'),
    path.join(kanbanRoot, 'Em_Andamento', 'em_andamento.md'),
    path.join(kanbanRoot, 'Concluido', 'concluido.md')
];
const mapFile = path.join(kanbanRoot, 'mapa_problemas_sistema.md');
const concludedFile = path.join(kanbanRoot, 'Concluido', 'concluido.md');

function relativePath(filePath: string): string {
    return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function readTextFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
}

function extractKbIds(content: string): string[] {
    return Array.from(content.matchAll(/KB-\d{3}/g)).map((match) => match[0]);
}

function collectCardOccurrences(filePath: string): CardOccurrence[] {
    const content = readTextFile(filePath);
    const ids = Array.from(content.matchAll(/^- \[[ xX]\] (KB-\d{3})\b/gm)).map((match) => match[1]);
    return ids.map((id) => ({ id, filePath }));
}

function validateRequiredFiles(issues: Issue[]): void {
    for (const filePath of [...boardFiles, mapFile]) {
        if (!fs.existsSync(filePath)) {
            issues.push({
                severity: 'error',
                code: 'missing_file',
                message: `Arquivo obrigatorio ausente: ${relativePath(filePath)}`
            });
        }
    }
}

function validateDuplicateIds(issues: Issue[]): CardOccurrence[] {
    const occurrences = boardFiles.flatMap((filePath) => collectCardOccurrences(filePath));
    const grouped = new Map<string, CardOccurrence[]>();

    for (const occurrence of occurrences) {
        const items = grouped.get(occurrence.id) ?? [];
        items.push(occurrence);
        grouped.set(occurrence.id, items);
    }

    for (const [id, items] of grouped.entries()) {
        if (items.length > 1) {
            const uniqueFilePaths = Array.from(new Set(items.map((item) => relativePath(item.filePath))));
            const message = uniqueFilePaths.length === 1
                ? `${id} aparece ${items.length} vezes no mesmo arquivo do quadro: ${uniqueFilePaths[0]}`
                : `${id} aparece em mais de um arquivo do quadro: ${uniqueFilePaths.join(', ')}`;

            issues.push({
                severity: 'error',
                code: 'duplicate_id',
                message
            });
        }
    }

    return occurrences;
}

function validateMapSync(occurrences: CardOccurrence[], issues: Issue[]): void {
    const mapIds = new Set(extractKbIds(readTextFile(mapFile)));

    for (const occurrence of occurrences) {
        if (!mapIds.has(occurrence.id)) {
            issues.push({
                severity: strictMode ? 'error' : 'warning',
                code: 'missing_in_map',
                message: `${occurrence.id} existe no quadro, mas nao foi encontrado em ${relativePath(mapFile)} (${relativePath(occurrence.filePath)})`
            });
        }
    }
}

function validateConcludedEvidence(issues: Issue[]): void {
    const content = readTextFile(concludedFile);
    const lines = content.split(/\r?\n/);
    let currentCardId: string | null = null;
    let hasEvidence = false;

    const flushCurrentCard = (): void => {
        if (currentCardId && !hasEvidence) {
            issues.push({
                severity: 'error',
                code: 'missing_evidence',
                message: `${currentCardId} em ${relativePath(concludedFile)} nao possui linha de evidencia.`
            });
        }
    };

    for (const line of lines) {
        const cardMatch = line.match(/^- \[x\] (KB-\d{3})\b/i);
        if (cardMatch) {
            flushCurrentCard();
            currentCardId = cardMatch[1];
            hasEvidence = false;
            continue;
        }

        if (currentCardId && /^\s*-\s*Evid[eê]ncia:/i.test(line)) {
            hasEvidence = true;
        }
    }

    flushCurrentCard();
}

function printIssues(issues: Issue[]): void {
    const errors = issues.filter((issue) => issue.severity === 'error');
    const warnings = issues.filter((issue) => issue.severity === 'warning');

    if (errors.length === 0 && warnings.length === 0) {
        console.log('[kanban-check] OK - nenhum problema encontrado.');
        return;
    }

    for (const issue of errors) {
        console.error(`[kanban-check][ERROR] ${issue.code}: ${issue.message}`);
    }

    for (const issue of warnings) {
        console.warn(`[kanban-check][WARN] ${issue.code}: ${issue.message}`);
    }

    console.log(`[kanban-check] Resumo: ${errors.length} erro(s), ${warnings.length} aviso(s).`);
}

function main(): void {
    const issues: Issue[] = [];
    validateRequiredFiles(issues);

    if (issues.some((issue) => issue.severity === 'error' && issue.code === 'missing_file')) {
        printIssues(issues);
        process.exit(1);
    }

    const occurrences = validateDuplicateIds(issues);
    validateMapSync(occurrences, issues);
    validateConcludedEvidence(issues);

    printIssues(issues);

    if (issues.some((issue) => issue.severity === 'error')) {
        process.exit(1);
    }
}

main();