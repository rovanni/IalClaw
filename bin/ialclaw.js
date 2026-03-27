#!/usr/bin/env node
/**
 * IalClaw CLI — mini process manager
 *
 * Uso:
 *   ialclaw start                → inicia em foreground
 *   ialclaw start --daemon       → inicia em background (desacoplado)
 *   ialclaw start --debug        → inicia com LOG_LEVEL=debug
 *   ialclaw start --debug --tail → debug + acompanha log em tempo real
 *   ialclaw stop                 → encerra o agente (via PID)
 *   ialclaw restart              → stop + start (preserva flags)
 *   ialclaw status               → verifica se está rodando
 *   ialclaw logs                 → exibe últimas linhas do log
 *   ialclaw logs --follow        → acompanha log em tempo real
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── ANSI ─────────────────────────────────────────────────────────────────────
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

// ── Paths ────────────────────────────────────────────────────────────────────
const root = path.resolve(__dirname, '..');
const stateDir = path.join(root, '.ialclaw');
const pidPath = path.join(stateDir, 'pid');
const lockPath = path.join(stateDir, 'lock');
const metaPath = path.join(stateDir, 'meta.json');
const logDir = path.join(root, 'logs');
const logPath = path.join(logDir, 'ialclaw.log');
const tsNode = path.join(root, 'node_modules', '.bin', 'ts-node' + (process.platform === 'win32' ? '.cmd' : ''));
const INITIAL_TAIL_LINES = 30;
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB

// ── Parse args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0];
const flags = args.slice(1);
const hasFlag = (name) => flags.includes(name);

// ── Versão ───────────────────────────────────────────────────────────────────
let version = '0.0.0';
try { version = require(path.join(root, 'package.json')).version || version; } catch {}
try {
    const gitHash = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    const isDirty = execSync('git status --porcelain', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim().length > 0;

    if (gitHash) {
        version = `${version}+${gitHash}${isDirty ? '-dirty' : ''}`;
    }
} catch {}

// ── PID helpers ──────────────────────────────────────────────────────────────
function ensureStateDir() {
    fs.mkdirSync(stateDir, { recursive: true });
}

function savePID(pid) {
    ensureStateDir();
    fs.writeFileSync(pidPath, String(pid), 'utf8');
}

function readPID() {
    try {
        const raw = fs.readFileSync(pidPath, 'utf8').trim();
        const pid = parseInt(raw, 10);
        return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch { return null; }
}

function clearPID() {
    try { fs.unlinkSync(pidPath); } catch {}
}

function isRunning(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
}

function killPID(pid) {
    try { process.kill(pid, 'SIGTERM'); return true; } catch { return false; }
}

// ── Lock helpers (evita race condition ao iniciar) ──────────────────────────
function acquireLock() {
    ensureStateDir();
    if (fs.existsSync(lockPath)) {
        try {
            const lockPid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
            if (Number.isFinite(lockPid) && isRunning(lockPid)) {
                console.log(`${YELLOW}⚠${RESET} IalClaw já está iniciando ${DIM}(PID ${lockPid})${RESET}`);
                process.exit(1);
            }
        } catch {}
        // Lock stale — limpa
        fs.unlinkSync(lockPath);
    }
    fs.writeFileSync(lockPath, String(process.pid), 'utf8');
}

function releaseLock() {
    try { fs.unlinkSync(lockPath); } catch {}
}

// ── Meta helpers (salva info de inicialização) ──────────────────────────────
function saveMeta(pid, mode, daemon) {
    ensureStateDir();
    const meta = { pid, mode, daemon, startedAt: Date.now() };
    fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8');
}

function readMeta() {
    try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return null; }
}

function clearMeta() {
    try { fs.unlinkSync(metaPath); } catch {}
}

// ── Log rotation ────────────────────────────────────────────────────────────
function rotateLogs() {
    try {
        if (!fs.existsSync(logPath)) return;
        const stats = fs.statSync(logPath);
        if (stats.size > MAX_LOG_SIZE) {
            const oldPath = logPath + '.old';
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            fs.renameSync(logPath, oldPath);
        }
    } catch {}
}

// ── Tail engine (cross-platform, pure Node) ─────────────────────────────────
function tailLog(follow) {
    fs.mkdirSync(logDir, { recursive: true });

    if (!fs.existsSync(logPath)) {
        console.log(`${DIM}(log vazio)${RESET}`);
        if (!follow) return;
        // Cria o arquivo para poder acompanhar
        fs.closeSync(fs.openSync(logPath, 'a'));
    }

    // Exibe últimas linhas
    try {
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split(/\r?\n/).filter(Boolean);
        if (lines.length > 0) {
            const tail = lines.slice(-INITIAL_TAIL_LINES);
            process.stdout.write(`${DIM}── ${tail.length} linha(s) recentes ──${RESET}\n`);
            process.stdout.write(`${tail.join('\n')}\n`);
        }
    } catch {}

    if (!follow) return;

    // Follow mode — polling via fs.watchFile (funciona em Windows e Unix)
    let offset = 0;
    try { offset = fs.statSync(logPath).size; } catch { offset = 0; }

    process.stdout.write(`${DIM}── acompanhando... (Ctrl+C para sair) ──${RESET}\n`);

    function readNew() {
        try {
            const stats = fs.statSync(logPath);
            if (stats.size < offset) offset = 0; // log rotacionou
            if (stats.size === offset) return;
            const stream = fs.createReadStream(logPath, {
                encoding: 'utf8', start: offset, end: stats.size - 1,
            });
            offset = stats.size;
            stream.on('data', (chunk) => process.stdout.write(chunk));
        } catch {}
    }

    fs.watchFile(logPath, { interval: 400 }, readNew);

    function cleanup() {
        fs.unwatchFile(logPath, readNew);
        process.exit(0);
    }
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

// ── Comandos ─────────────────────────────────────────────────────────────────

function start() {
    // Verifica se já está rodando
    const existingPid = readPID();
    if (isRunning(existingPid)) {
        console.log(`${YELLOW}⚠${RESET} IalClaw já está rodando ${DIM}(PID ${existingPid})${RESET}`);
        console.log(`  Use ${GREEN}ialclaw restart${RESET} para reiniciar ou ${GREEN}ialclaw stop${RESET} para parar.`);
        return;
    }
    clearPID(); // limpa PID stale

    // Lock — impede dois starts simultâneos
    acquireLock();

    // Rotação de logs antes de iniciar
    rotateLogs();

    const isDebug = hasFlag('--debug');
    const isDaemon = hasFlag('--daemon');
    const isTail = hasFlag('--tail');
    const mode = isDebug ? 'debug' : 'normal';

    const env = {
        ...process.env,
        LOG_LEVEL: isDebug ? 'debug' : (process.env.LOG_LEVEL || 'info'),
    };

    if (isDaemon) {
        // ── Daemon mode: desacoplado do terminal ─────────────────────
        fs.mkdirSync(logDir, { recursive: true });
        const outLog = fs.openSync(path.join(logDir, 'ialclaw-stdout.log'), 'a');
        const errLog = fs.openSync(path.join(logDir, 'ialclaw-stderr.log'), 'a');

        const child = spawn(tsNode, ['src/index.ts'], {
            cwd: root,
            stdio: ['ignore', outLog, errLog],
            env,
            detached: true,
            shell: process.platform === 'win32',
        });

        savePID(child.pid);
        saveMeta(child.pid, mode, true);
        releaseLock();
        child.unref();

        console.log('');
        console.log(`${CYAN}  🐙 IALCLAW${RESET} ${DIM}v${version}${RESET}`);
        console.log(`${DIM}  ─────────────────────────────────${RESET}`);
        console.log(`  ${DIM}status:${RESET}  ${GREEN}● iniciado em background${RESET}`);
        console.log(`  ${DIM}modo:${RESET}    ${GREEN}${mode}${RESET}`);
        console.log(`  ${DIM}PID:${RESET}     ${GREEN}${child.pid}${RESET}`);
        console.log('');
        console.log(`  ${DIM}→${RESET} ialclaw ${GREEN}status${RESET}        ${DIM}verificar${RESET}`);
        console.log(`  ${DIM}→${RESET} ialclaw ${GREEN}logs --follow${RESET} ${DIM}acompanhar${RESET}`);
        console.log(`  ${DIM}→${RESET} ialclaw ${GREEN}stop${RESET}          ${DIM}encerrar${RESET}`);
        console.log('');

        // Se pediu --tail junto com --daemon, entra em follow mode
        if (isTail) {
            tailLog(true);
        }

        return;
    }

    // ── Foreground mode: preso ao terminal (dev) ─────────────────────
    let exitScheduled = false;
    let shuttingDown = false;

    // Tail setup para modo foreground com --tail
    let offset = 0;
    if (isTail) {
        fs.mkdirSync(logDir, { recursive: true });
        fs.closeSync(fs.openSync(logPath, 'a'));
        try { offset = fs.statSync(logPath).size; } catch { offset = 0; }

        try {
            const content = fs.readFileSync(logPath, 'utf8');
            const lines = content.split(/\r?\n/).filter(Boolean);
            if (lines.length > 0) {
                const tail = lines.slice(-INITIAL_TAIL_LINES);
                process.stdout.write(`${DIM}── ${tail.length} linha(s) recentes ──${RESET}\n`);
                process.stdout.write(`${tail.join('\n')}\n`);
            }
        } catch {}
    }

    function readNewLogContent() {
        if (!isTail) return;
        try {
            const stats = fs.statSync(logPath);
            if (stats.size < offset) offset = 0;
            if (stats.size === offset) return;
            const stream = fs.createReadStream(logPath, {
                encoding: 'utf8', start: offset, end: stats.size - 1,
            });
            offset = stats.size;
            stream.on('data', (chunk) => process.stdout.write(chunk));
        } catch {}
    }

    const child = spawn(tsNode, ['src/index.ts'], {
        cwd: root,
        stdio: isTail ? ['inherit', 'ignore', 'ignore'] : 'inherit',
        env,
        shell: process.platform === 'win32',
    });

    savePID(child.pid);
    saveMeta(child.pid, mode, false);
    releaseLock();

    if (isTail) {
        fs.watchFile(logPath, { interval: 400 }, readNewLogContent);
    }

    function cleanupAndExit(code) {
        if (exitScheduled) return;
        exitScheduled = true;
        if (isTail) fs.unwatchFile(logPath, readNewLogContent);
        clearPID();
        clearMeta();
        releaseLock();
        setTimeout(() => process.exit(code), 200);
    }

    function stopChild(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        if (isTail) process.stdout.write(`\n${DIM}[tail] encerrando...${RESET}\n`);
        if (!child.killed) child.kill(signal);
        setTimeout(() => cleanupAndExit(0), 500);
    }

    process.on('SIGINT', () => stopChild('SIGINT'));
    process.on('SIGTERM', () => stopChild('SIGTERM'));

    child.on('error', (err) => {
        process.stderr.write(`${RED}✖ falha ao iniciar: ${err.message}${RESET}\n`);
        cleanupAndExit(1);
    });

    child.on('exit', (code, signal) => {
        if (isTail) readNewLogContent();
        cleanupAndExit(signal ? 0 : (code ?? 0));
    });
}

function stop() {
    const pid = readPID();
    if (!pid || !isRunning(pid)) {
        clearPID();
        clearMeta();
        console.log(`${DIM}○${RESET} Nenhum processo ativo.`);
        return;
    }

    killPID(pid);
    clearPID();
    clearMeta();
    console.log(`${GREEN}✔${RESET} IalClaw encerrado ${DIM}(PID ${pid})${RESET}`);
}

function restart() {
    const pid = readPID();
    if (pid && isRunning(pid)) {
        console.log(`${CYAN}🔄${RESET} Parando IalClaw ${DIM}(PID ${pid})${RESET}...`);
        killPID(pid);
        clearPID();
    }

    // Aguarda o processo anterior encerrar, depois inicia com as mesmas flags
    setTimeout(() => start(), 800);
}

function status() {
    const pid = readPID();
    if (pid && isRunning(pid)) {
        const meta = readMeta();
        const mode = meta?.mode || 'normal';
        const daemon = meta?.daemon ? 'sim' : 'não';
        let uptimeStr = '';
        if (meta?.startedAt) {
            const secs = Math.floor((Date.now() - meta.startedAt) / 1000);
            if (secs < 60) uptimeStr = `${secs}s`;
            else if (secs < 3600) uptimeStr = `${Math.floor(secs / 60)}m ${secs % 60}s`;
            else uptimeStr = `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
        }
        console.log('');
        console.log(`  ${GREEN}●${RESET} IalClaw rodando`);
        console.log(`  ${DIM}PID:${RESET}     ${pid}`);
        if (uptimeStr) console.log(`  ${DIM}uptime:${RESET}  ${uptimeStr}`);
        console.log(`  ${DIM}modo:${RESET}    ${mode}`);
        console.log(`  ${DIM}daemon:${RESET}  ${daemon}`);
        console.log('');
    } else {
        if (pid) { clearPID(); clearMeta(); }
        console.log(`${DIM}○${RESET} IalClaw parado`);
    }
}

function logs() {
    const follow = hasFlag('--follow') || hasFlag('-f');
    tailLog(follow);
}

function help() {
    console.log(`
${CYAN}🐙 IALCLAW CLI${RESET} ${DIM}v${version}${RESET}

${DIM}Comandos:${RESET}
  ialclaw ${GREEN}start${RESET}                 Inicia o agente (foreground)
  ialclaw ${GREEN}start --daemon${RESET}         Inicia em background
  ialclaw ${GREEN}start --debug${RESET}          Inicia com log detalhado
  ialclaw ${GREEN}start --debug --tail${RESET}   Debug + log em tempo real
  ialclaw ${GREEN}stop${RESET}                  Encerra o agente
  ialclaw ${GREEN}restart${RESET}               Reinicia o agente
  ialclaw ${GREEN}status${RESET}                Verifica se está rodando
  ialclaw ${GREEN}logs${RESET}                  Exibe últimas linhas do log
  ialclaw ${GREEN}logs --follow${RESET}          Acompanha log em tempo real
`);
}

// ── Router ───────────────────────────────────────────────────────────────────
switch (command) {
    case 'start':   start();   break;
    case 'stop':    stop();    break;
    case 'restart': restart(); break;
    case 'status':  status();  break;
    case 'logs':    logs();    break;
    case 'help':
    case '--help':
    case '-h':      help();    break;
    default:        help();    break;
}
