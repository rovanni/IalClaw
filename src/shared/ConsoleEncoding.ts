import { execFileSync } from 'child_process';

let consoleEncodingInitialized = false;

export function initializeConsoleEncoding(): void {
    if (consoleEncodingInitialized) {
        return;
    }

    consoleEncodingInitialized = true;

    if (process.platform !== 'win32') {
        return;
    }

    try {
        const cmdPath = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
        execFileSync(cmdPath, ['/d', '/s', '/c', 'chcp 65001 > nul'], {
            stdio: 'ignore',
            windowsHide: true
        });
    } catch {
    }

    try {
        process.stdout.setDefaultEncoding('utf8');
        process.stderr.setDefaultEncoding('utf8');
    } catch {
    }
}