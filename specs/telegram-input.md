[🇧🇷 Ver versão em Português](#-versão-em-português)

# 📥 Spec: Telegram Input Handler (Cognitive Input Layer)

**Version:** 3.0  
**Status:** Unified Cognitive Pipeline  
**Author:** Luciano + IalClaw Agent  
**Date:** March 24, 2026  

---

## 1. 🎯 Purpose

The Telegram Input module is responsible for:
* Receiving raw Telegram events
* Validating security (whitelist)
* Processing different content types (Text, Audio, Documents/Images)
* Converting everything into **structured text**
* Enriching with metadata
* Forwarding parsed inputs to the Semantic Gateway

---

## 2. 🧠 Role in Architecture

`Telegram → InputHandler → Semantic Gateway → AgentPlanner`

The InputHandler is the physical entry point to the cognitive system.

---

## 3. 📦 Supported Input Types

### 3.1 Text
Direct user interaction, basic flow.

### 3.2 Documents
Supported: `.pdf`, `.md`, `.txt`
Flow: Download → Extract Text → Clean → Forward

### 3.3 Audio / Voice (`message:voice`, `message:audio`)
Flow: Download → Transcribe via Local Whisper → Convert to text → Set `requires_audio_reply` flag

---

## 4. 🔐 Security
* Whitelist validation (`TELEGRAM_ALLOWED_USER_IDS`)
* Silent rejection of unauthorized users
* Zero exposure of sensitive data

---

## 5. ⚙️ Processing Pipeline
`Receive Message → Validate User → Identify Type → Extract Content → Normalize → Enrich Metadata → Send to Gateway`

---

## 6. 🧠 Cognitive Enrichment
Before sending to the Gateway, it flags requirements:
```json
{
  "requires_audio_reply": true/false,
  "source_type": "text | audio | document"
}
```

---

## 7. ⚡ User Feedback
While processing:
* `typing` → text
* `record_voice` → audio/TTS processing

---

## 8. 📁 File Management
* Temp directory: `/tmp` or local workspace
* Mandatory deletion of tmp files after processing to prevent leaks.

---

<br><br>

# 🇧🇷 Versão em Português

# 📥 Spec: Telegram Input Handler (Cognitive Input Layer)

**Versão:** 3.0  
**Status:** Unified Cognitive Pipeline  
**Autor:** Luciano + IalClaw Agent  
**Data:** 24 de março de 2026  

---

## 1. 🎯 Propósito

O módulo Telegram Input é responsável por:
* Receber eventos do Telegram
* Validar segurança (whitelist)
* Processar diferentes tipos de entrada (texto, áudio, documentos)
* Converter tudo em **texto estruturado**
* Enriquecer com metadados
* Encaminhar para o Semantic Gateway

---

## 2. 🧠 Papel na Arquitetura

`Telegram → InputHandler → Semantic Gateway → AgentPlanner`

O InputHandler é o ponto de entrada do sistema cognitivo.

---

## 3. 📦 Tipos de Entrada Suportados

### 3.1 Texto
Entrada direta do usuário; fluxo mais simples.

### 3.2 Documentos
Suportados: `.pdf`, `.md`, `.txt`
Processo: Download → Extração de texto → Limpeza → Encaminhamento

### 3.3 Áudio / Voz
Processo: Download → Transcrição via Whisper local → Conversão para texto → Marcação de preferência de resposta em áudio (`requires_audio_reply`)

---

## 4. 🔐 Segurança
* Validação via whitelist (`TELEGRAM_ALLOWED_USER_IDS`)
* Rejeição silenciosa de usuários não autorizados

---

## 5. ⚙️ Pipeline de Processamento
`Receber mensagem → Validar usuário → Identificar tipo → Extrair conteúdo → Normalizar → Enriquecer metadados → Enviar para Gateway`

---

## 6. 📁 Gerenciamento de Arquivos
* Diretório temporário: `/tmp` ou no workspace
* Exclusão obrigatória de lixo temp após processamento para evitar vazamentos.
