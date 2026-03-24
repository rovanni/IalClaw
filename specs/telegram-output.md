# 📤 Spec: Telegram Output Handler (Cognitive Output Layer)

**Versão:** 2.0
**Status:** Atualizado com Cognição
**Autor:** Luciano + IalClaw Agent
**Data:** 23 de março de 2026

---

# 1. 🎯 Propósito

O módulo Telegram Output é responsável por:

* Entregar a resposta final ao usuário
* Adaptar o formato da resposta
* Garantir compatibilidade com limites do Telegram
* Suportar texto, arquivos e áudio

---

# 2. 🧠 Papel na Arquitetura

```text
AgentLoop → OutputHandler → Telegram
```

---

# 3. 📦 Tipos de Saída

---

## 3.1 Texto

* Respostas padrão
* Divididas em chunks se necessário

---

## 3.2 Arquivos (.md)

* Conteúdo estruturado
* Exportado como documento

---

## 3.3 Áudio (TTS)

* Gerado via Edge-TTS
* Enviado como voice message

---

# 4. ⚙️ Estratégias de Output

---

## 4.1 TextOutputStrategy

* Divide mensagens > 4096 caracteres
* Mantém ordem e legibilidade

---

## 4.2 FileOutputStrategy

* Detecta conteúdo estruturado
* Salva em `.md`
* Envia como arquivo

---

## 4.3 AudioOutputStrategy

* Ativado quando:

```text
requires_audio_reply = true
```

* Converte texto em áudio
* Envia como voice note

---

# 5. 🧠 Integração Cognitiva

* Recebe resultado do AgentLoop
* Não altera lógica da resposta
* Apenas adapta formato

---

# 6. ⚡ Limitações do Telegram

| Limite     | Valor           |
| ---------- | --------------- |
| Texto      | 4096 caracteres |
| Rate limit | variável        |

---

# 7. 🚫 Tratamento de Erros

---

## Erro de envio

```text
⚠️ Erro ao enviar mensagem
```

---

## Rate limit (429)

* Esperar tempo indicado
* Reenviar

---

## Falha TTS

* Fallback para texto
* Aviso opcional

---

## Falha de arquivo

* Enviar como texto
* Alertar usuário

---

# 8. 📁 Gerenciamento de Arquivos

* Uso de `/tmp`
* Exclusão após envio
* Evitar acúmulo

---

# 9. ⚡ Performance

* Envio sequencial (ordem garantida)
* Controle de flood
* Buffer de mensagens grandes

---

# 10. 🧩 Estrutura de Resposta

O OutputHandler deve preservar:

* Clareza
* Estrutura
* Sequência lógica

---

# 11. 🔄 Fluxo Final

```text
AgentLoop → OutputStrategy → Telegram API
```

---

# 12. 📌 Conclusão

O OutputHandler garante:

* Entrega confiável
* Compatibilidade com Telegram
* Experiência fluida

Sem ele, o sistema falha na comunicação com o usuário.
