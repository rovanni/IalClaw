# 📥 Spec: Telegram Input Handler (Cognitive Input Layer)

**Versão:** 2.0
**Status:** Atualizado com Cognição
**Autor:** Luciano + IalClaw Agent
**Data:** 23 de março de 2026

---

# 1. 🎯 Propósito

O módulo Telegram Input é responsável por:

* Receber eventos do Telegram
* Validar segurança (whitelist)
* Processar diferentes tipos de entrada (texto, áudio, documentos)
* Converter tudo em **texto estruturado**
* Enriquecer com metadados
* Encaminhar para o pipeline cognitivo

---

# 2. 🧠 Papel na Arquitetura

```text
Telegram → InputHandler → CognitiveMemory → AgentLoop
```

O InputHandler é o ponto de entrada do sistema cognitivo.

---

# 3. 📦 Tipos de Entrada Suportados

---

## 3.1 Texto

* Entrada direta do usuário
* Fluxo mais simples

---

## 3.2 Documentos

Suportados:

* `.pdf`
* `.md`

Processo:

1. Download
2. Extração de texto
3. Limpeza
4. Encaminhamento

---

## 3.3 Áudio / Voz

* `message:voice`
* `message:audio`

Processo:

1. Download
2. Transcrição via Whisper local
3. Conversão para texto
4. Marcação de preferência de resposta em áudio

---

# 4. 🔐 Segurança

* Validação via whitelist (`TELEGRAM_ALLOWED_USER_IDS`)
* Rejeição silenciosa de usuários não autorizados
* Nenhum dado sensível exposto

---

# 5. ⚙️ Pipeline de Processamento

```text
Receber mensagem
→ Validar usuário
→ Identificar tipo
→ Extrair conteúdo
→ Normalizar
→ Enriquecer metadados
→ Enviar para Controller
```

---

# 6. 🧠 Enriquecimento Cognitivo

Antes de enviar para o sistema:

* Detectar origem (texto, áudio, doc)
* Definir flags:

```json
{
  "requires_audio_reply": true/false,
  "source_type": "text | audio | document"
}
```

---

# 7. ⚡ Feedback ao Usuário

Durante processamento:

* `typing` → texto
* `record_voice` → áudio

---

# 8. 📁 Gerenciamento de Arquivos

* Diretório temporário: `/tmp`
* Exclusão obrigatória após uso
* Evitar vazamento de arquivos

---

# 9. 🚫 Tratamento de Erros

---

## Entrada inválida

Resposta:

```text
Formato não suportado.
```

---

## Falha de download

```text
Falha ao baixar arquivo. Tente novamente.
```

---

## Falha no Whisper

```text
Não foi possível processar o áudio.
```

---

## Arquivo muito grande

```text
Arquivo excede limite suportado.
```

---

# 10. ⚡ Performance

* IO assíncrono
* Processamento não bloqueante
* Exclusão imediata de arquivos

---

# 11. 🧠 Integração com Sistema Cognitivo

O InputHandler:

* NÃO toma decisões
* NÃO interpreta profundamente
* Apenas prepara dados para o CognitiveMemory

---

# 12. 🔄 Fluxo Final

```text
Input → Normalização → Metadados → Controller → CognitiveMemory
```

---

# 13. 📌 Conclusão

O InputHandler garante:

* Entrada confiável
* Dados padronizados
* Integração com pipeline cognitivo

Sem ele, o sistema não possui base consistente para raciocínio.
