import fs from 'fs';
import path from 'path';
import { getTraceId } from './TraceContext';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMeta = Record<string, unknown>;
type SerializableLogValue = string | number | boolean | null | undefined | SerializableLogObject | SerializableLogValue[];
type SerializableLogObject = { [key: string]: SerializableLogValue };

const LEVEL_WEIGHT: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
};

const configuredLevel = parseLevel(process.env.LOG_LEVEL);
const logDirectory = path.join(process.cwd(), process.env.LOG_DIR || 'logs');
const applicationLogPath = path.join(logDirectory, 'ialclaw.log');
const errorLogPath = path.join(logDirectory, 'ialclaw-error.log');

let initialized = false;

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
                timestamp: new Date().toISOString(),
                level: 'error',
                component: 'AppLogger',
                event: 'file_write_failed',
                message: error.message,
                target: filePath
            }));
        }
    });
}

function writeLog(level: LogLevel, component: string, event: string, message?: string, meta?: LogMeta, error?: unknown) {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[configuredLevel]) {
        return;
    }

    ensureLogDirectory();

    const traceId = getTraceId();
    const payload = {
        timestamp: new Date().toISOString(),
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
    if (level === 'error') {
        console.error(line);
        appendLine(errorLogPath, line);
    } else if (level === 'warn') {
        console.warn(line);
    } else {
        console.log(line);
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