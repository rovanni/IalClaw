import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
};

async function runSetup() {
    console.log("\n==========================================");
    console.log(" 🛠️  Configuração Interativa do IalClaw  🛠️ ");
    console.log("==========================================\n");
    console.log("Vamos configurar o seu assistente passo a passo. Se não souber o que colocar, apenas aperte Enter para usar o padrão.\n");


    // Escolha de idioma interativa
    console.log("0. Escolha o idioma:");
    console.log("   1 - English (en-US)");
    console.log("   2 - Português (pt-BR)");
    let langOption = await question("Digite 1 ou 2 [padrão: 2]: ");
    langOption = langOption.trim();
    let finalLang = "pt-BR";
    if (langOption === "1") {
        finalLang = "en-US";
    } else if (langOption === "2" || langOption === "") {
        finalLang = "pt-BR";
    } else {
        console.log("Opção inválida, usando padrão: pt-BR");
        finalLang = "pt-BR";
    }

    const ollamaHost = await question("1. Qual o endereço do Ollama? [Padrão: http://127.0.0.1:11434]: ");
    const finalOllamaHost = ollamaHost.trim() || "http://127.0.0.1:11434";

    const model = await question("2. Qual modelo de IA deseja usar? [Padrão: glm-5:cloud]: ");
    const finalModel = model.trim() || "glm-5:cloud";

    console.log("\n[DICA] Para criar um Bot no Telegram, fale com o @BotFather e copie o Token gerado.");
    console.log("[DICA] Se quiser usar apenas o dashboard web local por enquanto, deixe em branco.");
    const telegramToken = await question("3. Cole aqui o TELEGRAM_BOT_TOKEN (opcional): ");

    console.log("\n[DICA] O IalClaw é privado e seguro. Apenas você pode falar com ele.");
    console.log("[DICA] Para descobrir seu ID, mande um 'Oi' para o bot @userinfobot no Telegram.");
    const telegramId = await question("4. Cole aqui o seu ID do Telegram (opcional, ex: 8071707790): ");

    const envContent = `# Configurações do Provedor (Ollama local)
APP_LANG=${finalLang}
OLLAMA_HOST=${finalOllamaHost}

# Modelo Principal
MODEL=${finalModel}

# Conexão com o Telegram
TELEGRAM_BOT_TOKEN=${telegramToken.trim()}

# Seu ID do Telegram autorizado a conversar com o bot
TELEGRAM_ALLOWED_USER_IDS=${telegramId.trim()}
`;

    const envPath = path.join(process.cwd(), '.env');
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