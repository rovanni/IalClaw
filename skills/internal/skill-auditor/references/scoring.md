# Tabela de Scoring de Risco

Sistema de pontuação para calcular o score final de risco de uma skill auditada.

---

## Pesos por Categoria

| # | Categoria | Peso Base | Multiplicador | Notas |
|---|-----------|-----------|---------------|-------|
| 1 | Prompt Injection | +40 | ×1 por ocorrência (cap: 80) | Mesmo 1 ocorrência é crítico |
| 2 | Acesso /etc/ ou SSH/AWS keys | +35 | ×1 por arquivo afetado (cap: 70) | |
| 3 | Execução perigosa (rm -rf, eval shell) | +30 | ×1 por ocorrência (cap: 60) | |
| 4 | Exfiltração (curl/wget para externo) | +30 | ×1 por domínio único (cap: 60) | |
| 5 | Variáveis de ambiente sensíveis | +25 | ×1 por variável (cap: 50) | |
| 6 | Ofuscação (base64, fromCharCode) | +20 | ×1 por técnica (cap: 40) | |
| 7 | Downloads/instalações não declaradas | +15 | ×1 por pacote (cap: 30) | |

**Score máximo possível:** 390 (antes dos caps)  
**Score normalizado:** min(total_bruto, 100)

---

## Classificação Final

| Score | Nível | Emoji | Ação Recomendada |
|-------|-------|-------|------------------|
| 0–20 | BAIXO | 🟢 | Aprovar — skill aparentemente segura |
| 21–59 | MÉDIO | 🟡 | Revisar manualmente antes de ativar |
| 60–100 | ALTO | 🔴 | Bloquear ou colocar em quarentena imediatamente |

---

## Critérios de Override Automático

Independentemente do score numérico, escalar para **🔴 ALTO** automaticamente se:

1. **Qualquer** ocorrência de prompt injection (categoria 1)
2. Acesso confirmado a `~/.ssh/id_rsa` ou `/etc/shadow`
3. Pipe para execução remota: `curl ... | bash` ou `wget ... | sh`
4. Arquivo binário não documentado dentro da skill
5. Arquivo `.env` com credenciais hardcoded

## Decisão Operacional

Depois do score final, use esta decisão:

| Estado | Quando usar |
|--------|-------------|
| `approved` | Score baixo sem gatilhos críticos |
| `approved_with_restrictions` | Score baixo ou médio com uso justificável, mas que exige cautela |
| `manual_review` | Score médio sem contexto suficiente |
| `quarantined` | Score alto ou presença de gatilhos críticos com necessidade de preservar evidência |
| `blocked` | Skill explicitamente maliciosa ou inviável de manter disponível |

---

## Algoritmo de Cálculo

```python
def calcular_score(achados: dict) -> int:
    pesos = {
        "prompt_injection": (40, 80),
        "acesso_sensivel": (35, 70),
        "exec_perigoso": (30, 60),
        "exfiltracao": (30, 60),
        "env_vars": (25, 50),
        "ofuscacao": (20, 40),
        "downloads": (15, 30),
    }
    
    total = 0
    for categoria, ocorrencias in achados.items():
        peso, cap = pesos[categoria]
        contribuicao = min(ocorrencias * peso, cap)
        total += contribuicao
    
    return min(total, 100)  # normalizar em 100
```

---

## Exemplos de Scores

### Skill limpa (score: 0)
- Nenhum achado em nenhuma categoria
- → 🟢 BAIXO — Aprovar

### Skill com curl suspeito (score: 30)
- 1× exfiltração para domínio desconhecido: +30
- → 🟡 MÉDIO — Revisar manualmente

### Skill com prompt injection + SSH (score: 75)
- 1× prompt injection: +40
- 1× acesso ~/.ssh: +35
- Total bruto: 75 → normalizado: 75
- → 🔴 ALTO — Bloquear imediatamente

### Skill completamente maliciosa (score: 100)
- 2× prompt injection: +80 (cap)
- 2× acesso sensível: +70 (cap)
- 1× curl externo: +30
- 1× base64 ofuscado: +20
- Total bruto: 200 → normalizado: 100
- → 🔴 ALTO — Bloquear + reportar

---

## Falsos Positivos — Ajustes

Deduzir pontos em casos onde o contexto justifica o padrão:

| Situação | Ajuste |
|----------|--------|
| `curl` para `api.anthropic.com` documentado no README | -30 |
| `base64` usado para decode de assets (imagens/fontes) documentado | -20 |
| `~/.ssh` apenas para verificar se existe (não ler conteúdo) | -15 |
| `npm install` listado como prerequisito no README/docs | -15 |

**Regra:** O ajuste só se aplica se **houver documentação explícita** na skill justificando o uso. Em caso de dúvida, manter o score original.
