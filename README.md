# IalClaw Cognitive System v3.0

O IalClaw é um Agente Cognitivo 100% local e privado, desenvolvido em Node.js (TypeScript). Integrado diretamente no Telegram, ele conta com um **Dashboard Web Local** interativo para visualização de pensamentos.

---

# ⚠️ **Status: Experimental / Em desenvolvimento ativo (v3.0)**

Este projeto implementa um sistema cognitivo completo com Graph-RAG, memória híbrida e execução agentica.
Apesar de funcional, ainda está em fase de estabilização e validação de comportamento.

---

## 🧠 Características da Arquitetura v3.0 (Cérebro-Grafo Misto)
- **Busca Híbrida Inteligente**: Os Nós cognitivos agora guardam `embeddings` vetoriais gerados pelo Ollama salvos no SQLite! O AgentLoop executa RAG usando similaridade Cosseno cruzada com o Score do Grafo.
- **Consolidação de Memória ("Sonho")**: Um `MemoryDreamer` decai o grafo progressivamente e poda memórias episódicas (conversas do telegram) irrelevantes de tempo em tempo, otimizando o cérebro.
- **Painel Visual Web**: Acesse `http://localhost:3000` para ver os grafos neurais flutuando enquanto o Agente interage em tempo real.
- **Habilidades com braços no mundo**: Integrado com Web Search e File Reading!

---

## 🚀 Instalação Rápida com 1 Linha (One-Line Install)

### Linux / macOS
```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

### Windows (PowerShell)
```powershell
irm https://openclaw.ai/install.ps1 | iex
```

---

## 💻 Instalação/Execução Manual

1. Certifique-se de ter o **Node.js (>= 18)**.
2. Clone o repo:
   ```bash
   git clone https://github.com/SEU_USUARIO/ialclaw.git
   cd ialclaw
   ```
3. Instale pacotes (e visualize os pacotes Express/Ollama):
   ```bash
   npm install
   ```
4. Copie o `.env`:
   - Preencha primariamente com seu **`TELEGRAM_BOT_TOKEN`** e o Host da sua LLM.

5. Inicie:
   ```bash
   npm run dev
   ```
   > Abra o Telegram para conversar e acesse a porta 3000 no navegador para ver a Consciência!
