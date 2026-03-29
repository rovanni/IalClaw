import { installSkill } from "./internal/skill-installer";

function isValidUrl(url: string): boolean {
    return /^https:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*\//.test(url);
}

export async function skillInstallerWrapper(input: any) {
    if (input.git && !isValidUrl(input.git)) {
        return { success: false, error: "URL de git inválida." };
    }
    if (input.repo && !isValidUrl(input.repo)) {
        return { success: false, error: "URL de repo inválida." };
    }
    return installSkill(input);
}
