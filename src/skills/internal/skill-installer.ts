import { execSync } from "child_process";
import { resolvePath } from "../../utils/pathResolver";

export async function installSkill({ repo, npm, npx, git }: { repo?: string; npm?: string; npx?: string; git?: string }) {
  try {
    if (git) {
      // Clonar repositório git
      const dest = resolvePath(`/workspace/skills/public/${git.split('/').pop()?.replace('.git', '')}`);
      execSync(`git clone ${git} "${dest}"`, { stdio: "inherit" });
      return { success: true, data: { path: dest } };
    }
    if (npm) {
      execSync(`npm install ${npm}`, { stdio: "inherit" });
      return { success: true, data: { npm } };
    }
    if (npx) {
      execSync(`npx ${npx}`, { stdio: "inherit" });
      return { success: true, data: { npx } };
    }
    if (repo) {
      // Fallback para git
      const dest = resolvePath(`/workspace/skills/public/${repo.split('/').pop()?.replace('.git', '')}`);
      execSync(`git clone ${repo} "${dest}"`, { stdio: "inherit" });
      return { success: true, data: { path: dest } };
    }
    return { success: false, error: "Nenhum método de instalação fornecido." };
  } catch (err: any) {
    console.error("[SKILL INSTALL ERROR]", err);
    return { success: false, error: err.message };
  }
}
