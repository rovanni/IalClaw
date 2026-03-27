import { installSkill } from "./internal/skill-installer";

export async function skillInstallerWrapper(input: any) {
  // Validação de segurança básica
  if (input.git && !/^https:\/\//.test(input.git)) {
    return { success: false, error: "URL de git inválida." };
  }
  if (input.repo && !/^https:\/\//.test(input.repo)) {
    return { success: false, error: "URL de repo inválida." };
  }
  return installSkill(input);
}
