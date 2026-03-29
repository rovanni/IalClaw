import { exec } from "child_process";
import { promisify } from "util";
import { resolvePath } from "../../utils/pathResolver";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT = 60000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
        )
    ]);
}

function isValidGitUrl(url: string): boolean {
    return /^https:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*\//.test(url) && !url.includes('..');
}

function sanitizeArg(arg: string): string {
    return arg.replace(/[;&|`$()]/g, '');
}

export async function installSkill({ repo, npm, npx, git }: { repo?: string; npm?: string; npx?: string; git?: string }) {
    try {
        if (git) {
            if (!isValidGitUrl(git)) {
                return { success: false, error: "URL de git inválida." };
            }
            const dest = resolvePath(`/workspace/skills/public/${sanitizeArg(git.split('/').pop()?.replace('.git', '') || '')}`);
            await withTimeout(execAsync(`git clone "${git}" "${dest}"`), DEFAULT_TIMEOUT);
            return { success: true, data: { path: dest } };
        }
        if (npm) {
            const sanitizedNpm = sanitizeArg(npm);
            await withTimeout(execAsync(`npm install ${sanitizedNpm}`), DEFAULT_TIMEOUT);
            return { success: true, data: { npm } };
        }
        if (npx) {
            const sanitizedNpx = sanitizeArg(npx);
            await withTimeout(execAsync(`npx ${sanitizedNpx}`), DEFAULT_TIMEOUT);
            return { success: true, data: { npx } };
        }
        if (repo) {
            if (!isValidGitUrl(repo)) {
                return { success: false, error: "URL de repositório inválida." };
            }
            const dest = resolvePath(`/workspace/skills/public/${sanitizeArg(repo.split('/').pop()?.replace('.git', '') || '')}`);
            await withTimeout(execAsync(`git clone "${repo}" "${dest}"`), DEFAULT_TIMEOUT);
            return { success: true, data: { path: dest } };
        }
        return { success: false, error: "Nenhum método de instalação fornecido." };
    } catch (err: any) {
        console.error("[SKILL INSTALL ERROR]", err);
        return { success: false, error: err.message };
    }
}
