import fs from 'fs';
import path from 'path';
import { getTraceId } from './TraceContext';

function localTimestamp(): string {
    const now = new Date();
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
    const yyyy = now.getFullYear();
    const MM = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const oh = pad(Math.floor(Math.abs(offset) / 60));
    const om = pad(Math.abs(offset) % 60);
    return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}.${ms}${sign}${oh}:${om}`;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMeta = Record<string, unknown>;
type SerializableLogValue = string | number | boolean | null | undefined | SerializableLogObject | SerializableLogValue[];
type SerializableLogObject = { [key: string]: SerializableLogValue };
type CognitiveStage = 'start' | 'decision' | 'execution' | 'result';
type LogPayload = {
    timestamp: string;
    level: LogLevel;
    component: string;
    event: string;
    message?: string;
    trace_id?: string;
    pid: number;
    error?: SerializableLogValue;
} & SerializableLogObject;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
};

// ANSI colors for pretty console output
const ANSI = {
    RESET: '\x1b[0m',
    DIM: '\x1b[2m',
    CYAN: '\x1b[36m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    RED: '\x1b[31m',
    MAGENTA: '\x1b[35m',
};

const LEVEL_COLOR: Record<LogLevel, string> = {
    debug: ANSI.DIM,
    info: ANSI.CYAN,
    warn: ANSI.YELLOW,
    error: ANSI.RED,
};

const LEVEL_ICON: Record<LogLevel, string> = {
    debug: '│',
    info: 'ℹ',
    warn: '⚠',
    error: '✖',
};

const STAGE_COLOR: Record<CognitiveStage, string> = {
    start: ANSI.CYAN,
    decision: ANSI.MAGENTA,
    execution: ANSI.YELLOW,
    result: ANSI.GREEN,
};

const configuredLevel = parseLevel(process.env.LOG_LEVEL);
const consoleFormat = parseConsoleFormat(process.env.LOG_CONSOLE_FORMAT);
const logDirectory = path.join(process.cwd(), process.env.LOG_DIR || 'logs');
const applicationLogPath = path.join(logDirectory, 'ialclaw.log');
const errorLogPath = path.join(logDirectory, 'ialclaw-error.log');

let initialized = false;

function parseConsoleFormat(value?: string): 'pretty' | 'json' {
    const normalized = String(value || 'pretty').trim().toLowerCase();
    return normalized === 'json' ? 'json' : 'pretty';
}

function parseLevel(value?: string): LogLevel {
    const normalized = String(value || 'info').trim().toLowerCase();
    if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
        return normalized;
    }

    return 'info';
}

function ensureLogDirectory() {
    if (initialized) {
        return;
    }

    fs.mkdirSync(logDirectory, { recursive: true });
    initialized = true;
}

function normalizeError(error: unknown): SerializableLogValue {
    if (!error) {
        return undefined;
    }

    if (error instanceof Error) {
        const anyError = error as Error & {
            code?: string;
            errno?: string | number;
            type?: string;
            cause?: unknown;
            status?: number;
            status_code?: number;
            response?: { status?: number; statusText?: string };
        };

        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: anyError.code,
            errno: anyError.errno,
            type: anyError.type,
            cause: normalizeError(anyError.cause),
            status: anyError.status,
            status_code: anyError.status_code,
            response_status: anyError.response?.status,
            response_status_text: anyError.response?.statusText
        };
    }

    if (typeof error === 'object') {
        return sanitize(error);
    }

    return { message: String(error) };
}

function sanitize(value: unknown, depth: number = 0, seen: WeakSet<object> = new WeakSet()): SerializableLogValue {
    if (value === null || value === undefined) {
        return value;
    }

    if (depth > 4) {
        return '[max-depth]';
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'symbol') {
        return value.toString();
    }

    if (typeof value === 'function') {
        return `[function ${value.name || 'anonymous'}]`;
    }

    if (typeof value !== 'object') {
        return String(value);
    }

    if (value instanceof Error) {
        return normalizeError(value);
    }

    if (seen.has(value)) {
        return '[circular]';
    }

    seen.add(value);

    if (Array.isArray(value)) {
        return value.slice(0, 20).map((entry) => sanitize(entry, depth + 1, seen));
    }

    const output: SerializableLogObject = {};
    for (const [key, entry] of Object.entries(value)) {
        output[key] = sanitize(entry, depth + 1, seen);
    }

    return output;
}

function sanitizeMeta(meta?: LogMeta): SerializableLogObject {
    const sanitized = sanitize(meta || {});
    if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
        return sanitized as SerializableLogObject;
    }

    return {};
}

function appendLine(filePath: string, line: string) {
    fs.appendFile(filePath, `${line}\n`, (error) => {
        if (error) {
            console.error(JSON.stringify({
                timestamp: localTimestamp(),
                level: 'error',
                component: 'AppLogger',
                event: 'file_write_failed',
                message: error.message,
                target: filePath
            }));
        }
    });
}

function compactTraceId(traceId?: string): string | undefined {
    if (!traceId) {
        return undefined;
    }

    return traceId.slice(0, 8);
}

function getCognitiveStage(payload: LogPayload): CognitiveStage | null {
    const explicitStage = payload.cognitive_stage;
    if (explicitStage === 'start' || explicitStage === 'decision' || explicitStage === 'execution' || explicitStage === 'result') {
        return explicitStage;
    }

    if (payload.event.endsWith('_started')) {
        return 'start';
    }

    if (payload.event.includes('selected') || payload.event.includes('decision') || payload.event.includes('resolved')) {
        return 'decision';
    }

    if (payload.event.includes('execution') || payload.event.includes('tool_call_started') || payload.event.includes('chat_request_started')) {
        return 'execution';
    }

    if (payload.event.endsWith('_completed') || payload.event.endsWith('_failed') || payload.event === 'execution_summary') {
        return 'result';
    }

    return null;
}

function formatValue(value: SerializableLogValue): string {
    if (value === null) {
        return 'null';
    }

    if (value === undefined) {
        return 'undefined';
    }

    if (typeof value === 'string') {
        return value.length > 140 ? `${value.slice(0, 137)}...` : value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    return JSON.stringify(value);
}

function formatConsoleError(error?: SerializableLogValue): string | null {
    if (!error || typeof error !== 'object' || Array.isArray(error)) {
        return error ? formatValue(error) : null;
    }

    const normalized = error as SerializableLogObject;
    const pieces: string[] = [];

    if (typeof normalized.name === 'string') {
        pieces.push(normalized.name);
    }

    if (typeof normalized.message === 'string') {
        pieces.push(normalized.message);
    }

    if (typeof normalized.code === 'string') {
        pieces.push(`code=${normalized.code}`);
    }

    const cause = normalized.cause;
    if (cause && typeof cause === 'object' && !Array.isArray(cause)) {
        const causeObj = cause as SerializableLogObject;
        const causeName = typeof causeObj.name === 'string' ? causeObj.name : 'cause';
        const causeMessage = typeof causeObj.message === 'string' ? causeObj.message : formatValue(cause);
        pieces.push(`cause=${causeName}: ${causeMessage}`);
    }

    return pieces.length > 0 ? pieces.join(' | ') : JSON.stringify(normalized);
}

function formatCognitiveLabel(payload: LogPayload, stage: CognitiveStage): string {
    const fromPayload = payload.summary || payload.decision || payload.execution || payload.result;

    if (typeof fromPayload === 'string' && fromPayload.trim()) {
        return fromPayload.trim();
    }

    if (stage === 'start') {
        return 'MESSAGE_RECEIVED';
    }

    return `${payload.component}:${payload.event}`;
}

function formatCognitiveDetails(payload: LogPayload, traceLabel?: string): string[] {
    const detailKeys = [
        'mode',
        'route',
        'confidence',
        'success',
        'duration_ms',
        'response_length',
        'model',
        'tools_count',
        'messages_count',
        'reason'
    ];

    const details: string[] = [];

    if (traceLabel) {
        details.push(`trace=${traceLabel}`);
    }

    for (const key of detailKeys) {
        const value = payload[key];
        if (value !== undefined) {
            details.push(`${key}=${formatValue(value)}`);
        }
    }

    return details;
}

function formatCognitiveConsoleLine(payload: LogPayload, stage: CognitiveStage): string {
    const traceLabel = compactTraceId(typeof payload.trace_id === 'string' ? payload.trace_id : undefined);
    const stageLabel = stage.toUpperCase();
    const color = STAGE_COLOR[stage];
    const label = formatCognitiveLabel(payload, stage);
    const details = formatCognitiveDetails(payload, traceLabel);
    const messagePart = payload.message && payload.message !== label ? ` - ${payload.message}` : '';
    const detailPart = details.length > 0 ? ` ${ANSI.DIM}(${details.join(' ')})${ANSI.RESET}` : '';
    const errorPart = formatConsoleError(payload.error);

    return `${ANSI.DIM}${payload.timestamp}${ANSI.RESET} ${color}[${stageLabel}]${ANSI.RESET} ${label}${detailPart}${messagePart}${errorPart ? `\n  ${ANSI.RED}error: ${errorPart}${ANSI.RESET}` : ''}`;
}

export function formatConsoleLogLine(payload: LogPayload): string {
    const cognitiveStage = getCognitiveStage(payload);
    if (cognitiveStage) {
        return formatCognitiveConsoleLine(payload, cognitiveStage);
    }

    const traceLabel = compactTraceId(typeof payload.trace_id === 'string' ? payload.trace_id : undefined);
    const color = LEVEL_COLOR[payload.level];
    const icon = LEVEL_ICON[payload.level];
    const header = `${ANSI.DIM}${payload.timestamp}${ANSI.RESET} ${color}${icon} ${payload.level.toUpperCase()}${ANSI.RESET} ${payload.component}:${payload.event}`;
    const scopeBits = [traceLabel ? `trace=${traceLabel}` : null].filter(Boolean) as string[];

    const interestingKeys = [
        'conversation_id',
        'channel',
        'telegram_user_id',
        'telegram_chat_id',
        'update_id',
        'project_id',
        'model',
        'host',
        'duration_ms',
        'messages_count',
        'tools_count',
        'response_length',
        'diagnostic_code',
        'reason'
    ];

    for (const key of interestingKeys) {
        const value = payload[key];
        if (value !== undefined) {
            scopeBits.push(`${key}=${formatValue(value)}`);
        }
    }

    const messagePart = payload.message ? ` - ${payload.message}` : '';
    const metaPart = scopeBits.length > 0 ? ` ${ANSI.DIM}(${scopeBits.join(' ')})${ANSI.RESET}` : '';
    const errorPart = formatConsoleError(payload.error);

    return `${header}${messagePart}${metaPart}${errorPart ? `\n  ${ANSI.RED}error: ${errorPart}${ANSI.RESET}` : ''}`;
}

function writeLog(level: LogLevel, component: string, event: string, message?: string, meta?: LogMeta, error?: unknown) {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[configuredLevel]) {
        return;
    }

    ensureLogDirectory();

    const traceId = getTraceId();
    const payload: LogPayload = {
        timestamp: localTimestamp(),
        level,
        component,
        event,
        message,
        trace_id: traceId !== 'no-trace-id' ? traceId : undefined,
        pid: process.pid,
        ...sanitizeMeta(meta),
        error: normalizeError(error)
    };

    const line = JSON.stringify(payload);
    const consoleLine = consoleFormat === 'json' ? line : formatConsoleLogLine(payload);
    if (level === 'error') {
        console.error(consoleLine);
        appendLine(errorLogPath, line);
    } else if (level === 'warn') {
        console.warn(consoleLine);
    } else {
        console.log(consoleLine);
    }

    appendLine(applicationLogPath, line);
}

export class AppLogger {
    private component: string;
    private baseMeta: LogMeta;

    constructor(component: string, baseMeta: LogMeta = {}) {
        this.component = component;
        this.baseMeta = baseMeta;
    }

    public child(meta: LogMeta): AppLogger {
        return new AppLogger(this.component, { ...this.baseMeta, ...meta });
    }

    public debug(event: string, message?: string, meta?: LogMeta) {
        writeLog('debug', this.component, event, message, { ...this.baseMeta, ...(meta || {}) });
    }

    public info(event: string, message?: string, meta?: LogMeta) {
        writeLog('info', this.component, event, message, { ...this.baseMeta, ...(meta || {}) });
    }

    public warn(event: string, message?: string, meta?: LogMeta) {
        writeLog('warn', this.component, event, message, { ...this.baseMeta, ...(meta || {}) });
    }

    public error(event: string, error: unknown, message?: string, meta?: LogMeta) {
        writeLog('error', this.component, event, message, { ...this.baseMeta, ...(meta || {}) }, error);
    }
}

export function createLogger(component: string, baseMeta: LogMeta = {}) {
    return new AppLogger(component, baseMeta);
}