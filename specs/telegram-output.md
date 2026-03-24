[🇧🇷 Ver versão em Português](#-versão-em-português)

# 📤 Spec: Telegram Output Handler (Cognitive Output Layer)

**Version:** 3.0  
**Status:** Unified Cognitive Pipeline  
**Author:** Luciano + IalClaw Agent  
**Date:** March 24, 2026  

---

## 1. 🎯 Purpose

The Telegram Output module is responsible for:
* Delivering the final response to the user
* Adapting response formats
* Ensuring compatibility with Telegram limits
* Seamlessly supporting text, files, and audio

---

## 2. 🧠 Role in Architecture

`AgentLoop → OutputHandler → Telegram`

---

## 3. 📦 Output Types

### 3.1 Text
* Standard responses
* Split into chunks if > 4096 characters

### 3.2 Files (.md, artifacts)
* Structured content, code, or workspace artifacts
* Exported and sent as native Telegram documents

### 3.3 Audio (TTS)
* Generated via Edge-TTS / local piper
* Sent as a voice message whenever `requires_audio_reply = true`

---

## 4. ⚙️ Output Strategies

### 4.1 TextOutputStrategy
* Splits messages > 4096 chars safely.
* Maintains order and formatting readability.

### 4.2 FileOutputStrategy
* Serves artifacts created by the Workspace Tools.
* Detects heavy structured content and sends it as `.md` automatically instead of flooding chat.

### 4.3 AudioOutputStrategy
* Converts text to audio locally.
* Sends as native voice notes.

---

## 5. ⚡ Telegram Limitations
| Limit | Value |
| :--- | :--- |
| Text | 4096 chars per message |
| Rate limit | Variable (Code 429 mitigation applied) |

---

## 6. 🚫 Error Mitigation

* **Rate Limit (429):** Sleep and retry buffer.
* **TTS Failure:** Fallback to standard text response.
* **File Delivery Failure:** Send as raw text + alert user.

---

<br><br>

# 🇧🇷 Versão em Português

# 📤 Spec: Telegram Output Handler (Cognitive Output Layer)

**Versão:** 3.0  
**Status:** Unified Cognitive Pipeline  
**Autor:** Luciano + IalClaw Agent  
**Data:** 24 de março de 2026  

---

## 1. 🎯 Propósito

O módulo Telegram Output é responsável por:
* Entregar a resposta final ao usuário
* Adaptar formato e sintaxe
* Garantir compatibilidade com limites do Telegram (Tamanho / Rate Limit)
* Suportar entrega multimodais de texto, arquivos (artefatos) e áudio (TTS)

---

## 2. 🧠 Papel na Arquitetura

`AgentLoop → OutputHandler → Telegram`

---

## 3. 📦 Tipos de Saída e Estratégias

### 3.1 TextOutputStrategy
* Respostas padrão.
* Divide mensagens maiores que 4096 caracteres.

### 3.2 FileOutputStrategy
* Servidor de arquivos e artefatos de Workspace.
* Autodetecta conteúdos excessivamente longos e mascara em envios de documentos `.md` ao invés de flodar o chat.

### 3.3 AudioOutputStrategy
* Gera áudio caso `requires_audio_reply = true`.
* Aciona motores Edge-TTS para devolver uma voice note nativa.

---

## 4. 🚫 Tratamento de Erros e Rate Limits

* **Rate Limit (429):** Espera o tempo bloqueado e reenvia via retry buffer sequencial.
* **Falha no TTS:** Faz o fallback imediato para texto, com alerta de indisponibilidade de áudio.
* **Falha ao Upar Arquivo:** Imprime e recai para envio em texto fatiado.
