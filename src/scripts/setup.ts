import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { initializeConsoleEncoding } from '../shared/ConsoleEncoding';

initializeConsoleEncoding();

function parseEnvFile(envPath: string): Record<string, string> {
    if (!fs.existsSync(envPath)) return {};
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    const env: Record<string, string> = {};
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const [key, ...rest] = trimmed.split('=');
        env[key.trim()] = rest.join('=').trim();
    }
    return env;
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
};

async function runSetup() {
    const envPath = path.join(process.cwd(), '.env');
    const currentEnv = parseEnvFile(envPath);
    console.log("\n==========================================");
    console.log(" 🛠️  Configuração Interativa do IalClaw  🛠️ ");
    console.log("==========================================\n");
    console.log("Vamos configurar o seu assistente passo a passo. Se não souber o que colocar, apenas aperte Enter para usar o padrão.\n");



    // Escolha de idioma interativa
    const currentLang = currentEnv.APP_LANG || "pt-BR";
    console.log(`0. Escolha o idioma (atual: ${currentLang}):`);
    console.log("   1 - English (en-US)");
    console.log("   2 - Português (pt-BR)");
    let langOption = await question("Digite 1 ou 2 [padrão: 2]: ");
    langOption = langOption.trim();
    let finalLang = currentLang;
    if (langOption === "1") {
        finalLang = "en-US";
    } else if (langOption === "2" || langOption === "") {
        finalLang = "pt-BR";
    }



    // Pergunta se deseja usar o Ollama
    const currentUseOllama = currentEnv.USE_OLLAMA || "true";
    let useOllama = await question(`1. Deseja utilizar o Ollama local? (s/n) [atual: ${currentUseOllama}]: `);
    useOllama = useOllama.trim().toLowerCase();
    let finalUseOllama = currentUseOllama;
    if (useOllama) {
        finalUseOllama = (useOllama === "n" || useOllama === "nao" || useOllama === "não") ? "false" : "true";
    }

    const currentOllamaHost = currentEnv.OLLAMA_HOST || "http://127.0.0.1:11434";
    const ollamaHost = await question(`2. Qual o endereço do Ollama? [atual: ${currentOllamaHost}]: `);
    const finalOllamaHost = ollamaHost.trim() || currentOllamaHost;

    const currentOllamaBin = currentEnv.OLLAMA_BIN || "ollama";
    const ollamaBin = await question(`3. Caminho do binário do Ollama (atual: ${currentOllamaBin}): `);
    const finalOllamaBin = ollamaBin.trim() || currentOllamaBin;

    const currentModel = currentEnv.MODEL || "glm-5:cloud";
    const model = await question(`4. Qual modelo de IA deseja usar? [atual: ${currentModel}]: `);
    const finalModel = model.trim() || currentModel;

    console.log("\n[DICA] Para criar um Bot no Telegram, fale com o @BotFather e copie o Token gerado.");
    console.log("[DICA] Se quiser usar apenas o dashboard web local por enquanto, deixe em branco.");

    const currentTelegramToken = currentEnv.TELEGRAM_BOT_TOKEN || "";
    const telegramToken = await question(`5. Cole aqui o TELEGRAM_BOT_TOKEN (atual: ${currentTelegramToken}): `);
    const finalTelegramToken = telegramToken.trim() || currentTelegramToken;

    console.log("\n[DICA] O IalClaw é privado e seguro. Apenas você pode falar com ele.");
    console.log("[DICA] Para descobrir seu ID, mande um 'Oi' para o bot @userinfobot no Telegram.");
    const currentTelegramId = currentEnv.TELEGRAM_ALLOWED_USER_IDS || "";
    const telegramId = await question(`6. Cole aqui o seu ID do Telegram (atual: ${currentTelegramId}): `);
    const finalTelegramId = telegramId.trim() || currentTelegramId;



    const envContent = `# Configurações do Provedor (Ollama local)
APP_LANG=${finalLang}
USE_OLLAMA=${finalUseOllama}
OLLAMA_HOST=${finalOllamaHost}
OLLAMA_BIN=${finalOllamaBin}

# Modelo Principal
MODEL=${finalModel}

# Conexão com o Telegram
TELEGRAM_BOT_TOKEN=${finalTelegramToken}

# Seu ID do Telegram autorizado a conversar com o bot
TELEGRAM_ALLOWED_USER_IDS=${finalTelegramId}
`;


    fs.writeFileSync(envPath, envContent, 'utf8');

    console.log("\n✅ Arquivo .env criado com sucesso! Tudo pronto.");
    if (telegramToken.trim()) {
        console.log("▶️  Para iniciar o agente, digite: npm run dev\n");
    } else {
        console.log("▶️  Para iniciar em modo local sem Telegram, digite: npm run dev");
        console.log("🌐 Depois abra: http://localhost:3000\n");
    }
    rl.close();
}

runSetup().catch(console.error);