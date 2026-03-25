const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const cwd = process.cwd();
const logDir = path.join(cwd, 'logs');
const logPath = path.join(logDir, 'ialclaw.log');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const childCommand = process.platform === 'win32' ? 'cmd.exe' : npmCommand;
const childArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', `${npmCommand} run dev:debug`]
    : ['run', 'dev:debug'];

fs.mkdirSync(logDir, { recursive: true });
fs.closeSync(fs.openSync(logPath, 'a'));

let offset = 0;
let shuttingDown = false;
let exitScheduled = false;

try {
    offset = fs.statSync(logPath).size;
} catch {
    offset = 0;
}

process.stdout.write(`[dev:debug:tail] acompanhando ${path.relative(cwd, logPath)}\n`);

const child = spawn(childCommand, childArgs, {
    cwd,
    stdio: ['inherit', 'ignore', 'ignore'],
    env: process.env,
    windowsHide: false
});

function readNewLogContent() {
    try {
        const stats = fs.statSync(logPath);

        if (stats.size < offset) {
            offset = 0;
        }

        if (stats.size === offset) {
            return;
        }

        const stream = fs.createReadStream(logPath, {
            encoding: 'utf8',
            start: offset,
            end: stats.size - 1
        });

        offset = stats.size;
        stream.on('data', (chunk) => process.stdout.write(chunk));
    } catch {
        // Arquivo pode ainda nao estar pronto entre eventos.
    }
}

fs.watchFile(logPath, { interval: 500 }, readNewLogContent);

function cleanupAndExit(code) {
    if (exitScheduled) {
        return;
    }

    exitScheduled = true;
    fs.unwatchFile(logPath, readNewLogContent);
    setTimeout(() => process.exit(code), 200);
}

function stopChild(signal) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    process.stdout.write(`\n[dev:debug:tail] encerrando processo filho com ${signal}\n`);

    if (!child.killed) {
        child.kill(signal);
    }

    setTimeout(() => cleanupAndExit(0), 500);
}

process.on('SIGINT', () => stopChild('SIGINT'));
process.on('SIGTERM', () => stopChild('SIGTERM'));

child.on('error', (error) => {
    process.stderr.write(`[dev:debug:tail] falha ao iniciar processo: ${error.message}\n`);
    cleanupAndExit(1);
});

child.on('exit', (code, signal) => {
    readNewLogContent();

    if (signal) {
        process.stdout.write(`\n[dev:debug:tail] processo finalizado por sinal ${signal}\n`);
        cleanupAndExit(0);
        return;
    }

    process.stdout.write(`\n[dev:debug:tail] processo finalizado com codigo ${code ?? 0}\n`);
    cleanupAndExit(code ?? 0);
});