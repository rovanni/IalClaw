#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const stateDir = path.join(root, '.ialclaw');
const pidPath = path.join(stateDir, 'pid');
const lockPath = path.join(stateDir, 'lock');
const metaPath = path.join(stateDir, 'meta.json');
const configPath = path.join(root, 'config.json');
const logDir = path.join(root, 'logs');
const logPath = path.join(logDir, 'ialclaw.log');
const tsNodeCli = path.join(root, 'node_modules', 'ts-node', 'dist', 'bin.js');

const INITIAL_TAIL_LINES = 30;
const MAX_LOG_SIZE = 5 * 1024 * 1024;
const SUPPORTED_LANGS = ['pt-BR', 'en-US'];

const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

require('ts-node/register/transpile-only');
const { t, setLanguage } = require('../src/i18n');

const argv = process.argv.slice(2);
const command = argv[0];
const commandArgs = argv.slice(1);
const { langArg, cleanedArgs } = extractLangArg(commandArgs);
const flags = cleanedArgs;
const hasFlag = (name) => flags.includes(name);
const envLangFromShell = process.env.APP_LANG;

const cliLanguage = resolveCliLanguage({ langArg });
setLanguage(cliLanguage);
process.env.APP_LANG = cliLanguage;

let version = '0.0.0';
const versionFilePath = path.join(root, 'version.json');
try {
    if (fs.existsSync(versionFilePath)) {
        const versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
        version = versionData.version || version;
    } else {
        version = require(path.join(root, 'package.json')).version || version;
    }
} catch {}

try {
    const gitHash = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    const isDirty = execSync('git status --porcelain', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim().length > 0;
    if (gitHash && isDirty) {
        version = `${version}+${gitHash}-dirty`;
    }
} catch {}

function normalizeLanguage(lang) {
    return parseLanguage(lang) || 'en-US';
}

function parseLanguage(lang) {
    const value = String(lang || '').trim().toLowerCase();
    if (value === 'pt' || value === 'pt-br') return 'pt-BR';
    if (value === 'en' || value === 'en-us') return 'en-US';
    return null;
}

function extractLangArg(items) {
    const cleaned = [];
    let langArg = null;

    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (!item) continue;

        if (item.startsWith('--lang=')) {
            langArg = item.slice('--lang='.length);
            continue;
        }

        if (item === '--lang') {
            const next = items[i + 1];
            if (next && !next.startsWith('--')) {
                langArg = next;
                i += 1;
            }
            continue;
        }

        cleaned.push(item);
    }

    return { langArg, cleanedArgs: cleaned };
}

function readConfig() {
    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function writeConfig(config) {
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function resolveCliLanguage({ langArg }) {
    const argLang = parseLanguage(langArg);
    if (argLang) return argLang;
    if (process.env.APP_LANG) return normalizeLanguage(process.env.APP_LANG);

    const config = readConfig();
    if (typeof config.language === 'string' && config.language.trim()) {
        return normalizeLanguage(config.language);
    }

    return 'pt-BR';
}

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
    } catch {
        return null;
    }
}

function clearPID() {
    try {
        fs.unlinkSync(pidPath);
    } catch {}
}

function isRunning(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function killPID(pid) {
    try {
        process.kill(pid, 'SIGTERM');
        return true;
    } catch {
        return false;
    }
}

function acquireLock() {
    ensureStateDir();

    if (fs.existsSync(lockPath)) {
        try {
            const lockPid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
            if (Number.isFinite(lockPid) && isRunning(lockPid)) {
                console.log(`${YELLOW}!${RESET} ${t('cli.lock.active', { pid: lockPid })}`);
                process.exit(1);
            }
        } catch {}

        fs.unlinkSync(lockPath);
    }

    fs.writeFileSync(lockPath, String(process.pid), 'utf8');
}

function releaseLock() {
    try {
        fs.unlinkSync(lockPath);
    } catch {}
}

function saveMeta(pid, mode, daemon) {
    ensureStateDir();
    const meta = { pid, mode, daemon, startedAt: Date.now() };
    fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8');
}

function readMeta() {
    try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch {
        return null;
    }
}

function clearMeta() {
    try {
        fs.unlinkSync(metaPath);
    } catch {}
}

function rotateLogs() {
    try {
        if (!fs.existsSync(logPath)) return;
        const stats = fs.statSync(logPath);
        if (stats.size > MAX_LOG_SIZE) {
            const oldPath = `${logPath}.old`;
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            fs.renameSync(logPath, oldPath);
        }
    } catch {}
}

function tailLog(follow) {
    fs.mkdirSync(logDir, { recursive: true });

    if (!fs.existsSync(logPath)) {
        console.log(`${DIM}${t('cli.logs.empty')}${RESET}`);
        if (!follow) return;
        fs.closeSync(fs.openSync(logPath, 'a'));
    }

    try {
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split(/\r?\n/).filter(Boolean);
        if (lines.length > 0) {
            const tail = lines.slice(-INITIAL_TAIL_LINES);
            process.stdout.write(`${DIM}${t('cli.logs.recent_header', { count: tail.length })}${RESET}\n`);
            process.stdout.write(`${tail.join('\n')}\n`);
        }
    } catch {}

    if (!follow) return;

    let offset = 0;
    try {
        offset = fs.statSync(logPath).size;
    } catch {
        offset = 0;
    }

    process.stdout.write(`${DIM}${t('cli.logs.following')}${RESET}\n`);

    function readNew() {
        try {
            const stats = fs.statSync(logPath);
            if (stats.size < offset) offset = 0;
            if (stats.size === offset) return;

            const stream = fs.createReadStream(logPath, {
                encoding: 'utf8',
                start: offset,
                end: stats.size - 1
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

function start() {
    const existingPid = readPID();
    if (isRunning(existingPid)) {
        console.log(`${YELLOW}!${RESET} ${t('cli.start.already_running', { pid: existingPid })}`);
        console.log(`  ${t('cli.start.already_running_hint')}`);
        return;
    }

    clearPID();
    acquireLock();
    rotateLogs();

    const isDebug = hasFlag('--debug');
    const isDaemon = hasFlag('--daemon');
    const isTail = hasFlag('--tail');
    const mode = isDebug ? 'debug' : 'normal';

    const env = {
        ...process.env,
        APP_LANG: cliLanguage,
        LOG_LEVEL: isDebug ? 'debug' : (process.env.LOG_LEVEL || 'info')
    };

    if (isDaemon) {
        fs.mkdirSync(logDir, { recursive: true });
        const outLog = fs.openSync(path.join(logDir, 'ialclaw-stdout.log'), 'a');
        const errLog = fs.openSync(path.join(logDir, 'ialclaw-stderr.log'), 'a');

        const child = spawn(process.execPath, [tsNodeCli, 'src/index.ts'], {
            cwd: root,
            stdio: ['ignore', outLog, errLog],
            env,
            detached: true,
            shell: false
        });

        savePID(child.pid);
        saveMeta(child.pid, mode, true);
        releaseLock();
        child.unref();

        console.log('');
        console.log(`${CYAN}🐙 IALCLAW${RESET} ${DIM}v${version}${RESET}`);
        console.log(`  ${t('cli.start.daemon')}`);
        console.log(`  ${t('cli.start.mode', { mode })}`);
        console.log(`  ${t('cli.start.pid', { pid: child.pid })}`);
        console.log(`  ${t('cli.start.language', { language: cliLanguage })}`);
        console.log(`  ${t('cli.start.success')}`);
        console.log('');

        if (isTail) {
            tailLog(true);
        }

        return;
    }

    let exitScheduled = false;
    let shuttingDown = false;
    let offset = 0;

    if (isTail) {
        fs.mkdirSync(logDir, { recursive: true });
        fs.closeSync(fs.openSync(logPath, 'a'));
        try {
            offset = fs.statSync(logPath).size;
        } catch {
            offset = 0;
        }

        try {
            const content = fs.readFileSync(logPath, 'utf8');
            const lines = content.split(/\r?\n/).filter(Boolean);
            if (lines.length > 0) {
                const tail = lines.slice(-INITIAL_TAIL_LINES);
                process.stdout.write(`${DIM}${t('cli.logs.recent_header', { count: tail.length })}${RESET}\n`);
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
                encoding: 'utf8',
                start: offset,
                end: stats.size - 1
            });
            offset = stats.size;
            stream.on('data', (chunk) => process.stdout.write(chunk));
        } catch {}
    }

    const child = spawn(process.execPath, [tsNodeCli, 'src/index.ts'], {
        cwd: root,
        stdio: isTail ? ['inherit', 'ignore', 'ignore'] : 'inherit',
        env,
        shell: false
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
        if (isTail) process.stdout.write(`\n${DIM}${t('cli.logs.tail_closing')}${RESET}\n`);
        if (!child.killed) child.kill(signal);
        setTimeout(() => cleanupAndExit(0), 500);
    }

    process.on('SIGINT', () => stopChild('SIGINT'));
    process.on('SIGTERM', () => stopChild('SIGTERM'));

    child.on('error', (err) => {
        process.stderr.write(`${RED}${t('cli.start.error', { message: err.message })}${RESET}\n`);
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
        console.log(`${DIM}${t('cli.stop.none_running')}${RESET}`);
        return;
    }

    console.log(t('cli.stop.running'));
    killPID(pid);
    clearPID();
    clearMeta();
    console.log(`${GREEN}${t('cli.stop.success', { pid })}${RESET}`);
}

function restart() {
    const pid = readPID();
    console.log(t('cli.restart'));

    if (pid && isRunning(pid)) {
        killPID(pid);
        clearPID();
    }

    setTimeout(() => start(), 800);
}

function formatUptime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function status() {
    const pid = readPID();
    if (pid && isRunning(pid)) {
        const meta = readMeta();
        const mode = meta?.mode || 'normal';
        const daemon = meta?.daemon ? t('cli.status.yes') : t('cli.status.no');

        console.log(t('cli.status.running'));
        console.log(t('cli.status.pid', { pid }));
        if (meta?.startedAt) {
            const secs = Math.floor((Date.now() - meta.startedAt) / 1000);
            console.log(t('cli.status.uptime', { uptime: formatUptime(secs) }));
        }
        console.log(t('cli.status.mode', { mode }));
        console.log(t('cli.status.daemon', { daemon }));
        console.log(t('cli.status.language', { language: cliLanguage }));
        return;
    }

    if (pid) {
        clearPID();
        clearMeta();
    }

    console.log(t('cli.status.stopped'));
}

function logs() {
    const follow = hasFlag('--follow') || hasFlag('-f');
    console.log(t('cli.logs.loading'));
    tailLog(follow);
}

function lang() {
    const maybeLang = flags[0];

    if (!maybeLang) {
        const config = readConfig();
        const configured = typeof config.language === 'string' ? normalizeLanguage(config.language) : t('cli.lang.not_set');
        console.log(t('cli.lang.current', { language: cliLanguage }));
        console.log(t('cli.lang.configured', { language: configured }));
        if (envLangFromShell) {
            console.log(t('cli.lang.env_override', { language: normalizeLanguage(envLangFromShell) }));
        }
        return;
    }

    const parsed = parseLanguage(maybeLang);
    if (!parsed || !SUPPORTED_LANGS.includes(parsed)) {
        console.error(t('cli.lang.invalid', { value: maybeLang, supported: SUPPORTED_LANGS.join(', ') }));
        process.exit(1);
    }

    const config = readConfig();
    config.language = parsed;
    writeConfig(config);

    setLanguage(parsed);
    process.env.APP_LANG = parsed;
    console.log(t('cli.lang.updated', { language: parsed }));
}

function help() {
    console.log(`${CYAN}🐙 IALCLAW CLI${RESET} ${DIM}v${version}${RESET}`);
    console.log(t('cli.help.title'));
    console.log(t('cli.help.start'));
    console.log(t('cli.help.start_daemon'));
    console.log(t('cli.help.start_debug'));
    console.log(t('cli.help.start_debug_tail'));
    console.log(t('cli.help.stop'));
    console.log(t('cli.help.restart'));
    console.log(t('cli.help.status'));
    console.log(t('cli.help.logs'));
    console.log(t('cli.help.logs_follow'));
    console.log(t('cli.help.lang')); 
    console.log(t('cli.help.lang_set'));
    console.log(t('cli.help.lang_flag'));
}

switch (command) {
    case 'start':
        start();
        break;
    case 'stop':
        stop();
        break;
    case 'restart':
        restart();
        break;
    case 'status':
        status();
        break;
    case 'logs':
        logs();
        break;
    case 'lang':
        lang();
        break;
    case 'help':
    case '--help':
    case '-h':
    default:
        help();
        break;
}
