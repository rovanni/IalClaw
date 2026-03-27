---
name: skill-installer
description: >
  Skill interna do IalClaw para descobrir, avaliar e instalar skills públicas do marketplace
  https://skills.sh/ de forma segura. Inclui busca por ranking e trending, confirmação com
  o usuário, download, auditoria automática via skill-auditor e rollback caso a skill seja
  reprovada. Use esta skill sempre que o usuário quiser instalar, descobrir ou avaliar uma
  skill pública.
compatibility:
  tools: [fetch_url, write_skill_file, delete_skill_public, read_audit_log, run_skill_auditor, reload_skills, web_search, read_local_file]
  context: IalClaw Cognitive System v3.0
metadata:
  kind: internal
  trusted: true
  manages: public-skills
---

# Skill Installer

Ferramenta interna do IalClaw para instalação segura de skills públicas.

Marketplace oficial: **https://skills.sh/**

---

## Quando usar

Acione esta skill quando o usuário:

- quiser instalar uma skill pública (`/install-skill <tema>`);
- pedir para descobrir skills sobre um assunto;
- quiser saber quais são as melhores skills disponíveis;
- precisar de capacidade adicional que provavelmente existe como skill pública;
- executar o comando abaixo.

**Triggers via slash command:**
```
/install-skill <tema>
/find-skill <tema>
/skill-install <nome-exato>
```

---

## Regra fundamental de segurança

> **Nenhuma skill pública é instalada sem passar pelo skill-auditor.**
>
> Se a auditoria retornar `blocked`, `quarantined` ou `manual_review`, a skill **não é instalada**
> e os arquivos baixados são removidos imediatamente.
> O usuário é informado do motivo com clareza.

---

## Passo 1 — Buscar skills no marketplace

Tente buscar a API oficial do marketplace:

```
GET https://skills.sh/api/search?q=<tema>&sort=rank&limit=8
```

Se a resposta for JSON válido, prossiga para o Passo 2.

Se a requisição falhar ou retornar HTML, use o `web_search` como fallback:

```
web_search: site:skills.sh "<tema>"
```

Extraia das respostas:
- Nome da skill
- Descrição breve
- Ranking / posição
- Badge de trending (se houver)
- Número de downloads / instalações

---

## Passo 2 — Apresentar opções ao usuário

Exiba um resumo formatado das skills encontradas. Exemplo:

```
📦 Skills encontradas para "<tema>" em skills.sh:

1. ✨ [skill-name-a] — "Descrição curta da skill"
   ⭐ Rank #1 | 🔥 Trending | 📥 12.432 instalações

2. [skill-name-b] — "Outra descrição"
   ⭐ Rank #3 | 📥 7.891 instalações

3. [skill-name-c] — "Outra descrição"
   ⭐ Rank #5 | 📥 4.210 instalações

Qual delas você deseja instalar? (informe o número ou o nome)
```

Antes da lista, explicite sempre o contexto da acao em uma frase curta, por exemplo:

```
Essas sao as skills disponiveis para instalacao:
```

Se o usuario responder apenas com:
- `1`, `2`, `3`, etc.
- ou repetir o nome da skill

isso deve ser tratado como selecao direta da skill e inicio imediato do fluxo de instalacao para a opcao escolhida.
Nao peca uma segunda confirmacao da mesma escolha.

Critérios de ordenação prioritária:
1. Trending + rank alto = aparece primeiro
2. Rank alto sozinho = segundo
3. Mais instalações = desempate

---

## Passo 3 — Resolver seleção e iniciar execução

Quando o usuario selecionar uma opcao (numero ou nome), assuma a escolha como comando executavel e prossiga diretamente para o download e auditoria.

Resposta esperada nesse ponto:

```
Opcao selecionada: [skill-name-a]
Iniciando download e auditoria de seguranca agora.
```

Em seguida, prossiga para o Passo 4 sem solicitar nova confirmacao.

---

## Passo 4 — Baixar a skill

Tente obter o pacote da skill via API:

```
GET https://skills.sh/api/skills/<nome>/download
```

A resposta esperada é um JSON com os arquivos da skill:

```json
{
  "name": "skill-name-a",
  "files": {
    "SKILL.md": "<conteúdo completo do SKILL.md>",
    "skill.json": "<conteúdo do skill.json>",
    "README.md": "<opcional>"
  }
}
```

Se a API principal falhar, tente o endpoint alternativo:

```
GET https://raw.githubusercontent.com/skills-sh/<nome>/main/SKILL.md
```

Para cada arquivo recebido, salve em `skills/public/`:

```tool
write_skill_file(skill_name="<nome>", filename="SKILL.md",   content="<conteúdo>")
write_skill_file(skill_name="<nome>", filename="skill.json", content="<conteúdo>")
```

Se não houver `skill.json`, crie um mínimo automaticamente:

```json
{
  "name": "<nome>",
  "kind": "public",
  "trusted": false,
  "version": "downloaded",
  "entry": "SKILL.md",
  "source": "https://skills.sh/"
}
```

Avise o usuário:

```
⬇️ Skill "<nome>" baixada para skills/public/<nome>/
🔍 Iniciando auditoria de segurança...
```

---

## Passo 5 — Auditar com o skill-auditor

Execute a auditoria de segurança programática usando a tool `run_skill_auditor`:

```tool
run_skill_auditor(skill_name="<nome>")
```

A tool executa análise estática, calcula score de risco e grava a decisão em `data/skill-audit-log.json`.

Em seguida, leia o resultado com:

```tool
read_audit_log(skill_name="<nome>")
```

O campo `decision` terá um dos seguintes valores:

| Decisão                    | Significado                                              |
|----------------------------|----------------------------------------------------------|
| `approved`                 | Skill limpa, pronta para uso                             |
| `approved_with_restrictions` | Aprovada, mas com ressalvas documentadas               |
| `manual_review`            | Requer revisão humana antes de ativar                    |
| `quarantined`              | Suspeita — isolada, não instalada                        |
| `blocked`                  | Bloqueada por risco crítico — removida imediatamente     |

---

## Passo 6 — Reportar e finalizar

### ✅ Se `approved` ou `approved_with_restrictions`:

Ative a skill imediatamente com hot-reload:

```tool
reload_skills()
```

Depois informe:

```
✅ Skill "<nome>" aprovada pela auditoria de segurança e ativada!

Decisão: approved
Motivo: <motivo do skill-auditor>

A skill já está disponível para uso.
```

Se houver restrições, liste-as claramente para o usuário.

---

### ⚠️ Se `manual_review`:

```
⚠️ A skill "<nome>" requer revisão manual antes de ser ativada.

A skill foi mantida em skills/public/<nome>/ mas NÃO será carregada
automaticamente pelo runtime até que um operador a aprove.

Para revisar manualmente:
  1. Leia skills/public/<nome>/SKILL.md com atenção.
  2. Execute /skill-auditor --path skills/public/<nome> para reavaliação.
  3. Se concluir que é segura, edite data/skill-audit-log.json e mude
     a última entrada para "decision": "approved".
```

---

### 🚫 Se `quarantined`:

```
🚫 A skill "<nome>" foi colocada em quarentena.

Motivo: <motivo do skill-auditor>

Os arquivos foram removidos de skills/public/ por segurança.
Consulte o relatório completo de auditoria para detalhes.
```

Execute o rollback:

```tool
delete_skill_public(skill_name="<nome>")
```

---

### ❌ Se `blocked`:

```
❌ INSTALAÇÃO BLOQUEADA — skill "<nome>" apresenta risco crítico de segurança.

Motivo: <motivo do skill-auditor>
Padrão detectado: <padrão, ex: prompt_injection, data_exfil>

A skill foi removida imediatamente. Não será instalada.
```

Execute o rollback:

```tool
delete_skill_public(skill_name="<nome>")
```

---

## Comportamento de falha (fallback)

Se ao longo de qualquer passo o download falhar completamente:

1. Informe o usuário com a mensagem de erro específica.
2. Sugira buscar manualmente em https://skills.sh/skills/<nome>
3. Explique como instalar manualmente:
   - Criar `skills/public/<nome>/SKILL.md` com o conteúdo da skill
   - Executar `/skill-auditor <nome>` para auditar
   - Se aprovada, reiniciar o IalClaw

---

## Regras de conduta desta skill

- A selecao numerica ou por nome no Passo 2 vale como confirmacao explicita da escolha.
- Nunca pedir confirmacao redundante apos o usuario selecionar uma opcao valida.
- Nunca pular o passo de auditoria, mesmo que o usuário solicite.
- Nunca instalar uma skill com decisão `blocked` ou `quarantined`.
- Sempre informar o usuário do resultado — inclusive quando a auditoria passa.
- Em caso de dúvida sobre segurança, prefira não instalar.
