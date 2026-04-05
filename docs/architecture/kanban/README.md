# Kanban de Arquitetura - Single Brain

**Objetivo**: Centralizar o acompanhamento do desenvolvimento em um quadro objetivo, com organização física por status para garantir a integridade da arquitetura de cérebro único.

O Kanban é o ponto central de rastreio operacional, enquanto os documentos técnicos (diagnósticos, mapas e planos) permanecem como fontes de desenho e fundamentação.

---

## 📂 Estrutura de Arquivos
A organização física reflete o ciclo de vida de cada tarefa:

* **Mapa Geral**: `mapa_problemas_sistema.md` (O radar central de todos os problemas).
* **Pasta `Pendente/`**:
    * `problemas_criticos.md`: Riscos estruturais e governança do Orchestrator.
    * `problemas_medios.md`: Modularizações e acoplamentos.
    * `problemas_baixos.md`: Padronizações e dívidas técnicas menores.
* **Pasta `Em_Andamento/`**:
    * `em_andamento.md`: Cards em execução ativa.
* **Pasta `Testes/`**:
    * `testes.md`: Registro de evidências de runtime e validação.
* **Pasta `Concluido/`**:
    * `concluido.md`: Log de tarefas finalizadas com sucesso.
* **Pasta `historico/`**:
    * `checklist_vivo.md`: Rastro histórico de verificações.
    * `KB-XXX_*.md`: Documentação técnica detalhada para cada card crítico concluído.

---

## 🔄 Ciclo de Vida (Cheat Sheet)

| Fase | Ação | Arquivo Destino |
| :--- | :--- | :--- |
| **1. Identificar** | Registrar novo problema no Mapa | `mapa_problemas_sistema.md` |
| **2. Triar** | Criar card com ID `KB-XXX` na prioridade correta | `Pendente/*.md` |
| **3. Executar** | Mover card para execução | `Em_Andamento/em_andamento.md` |
| **4. Validar** | Registrar logs e resultados de testes | `Testes/testes.md` |
| **5. Finalizar** | Mover para concluído com evidência curta | `Concluido/concluido.md` |
| **6. Documentar** | Se crítico, criar documento técnico detalhado | `historico/KB-XXX_*.md` |

---

## 🛠️ Regras de Ouro e Automação
Como o sistema é padronizado em **TypeScript**, a manutenção do Kanban deve seguir o mesmo rigor:

1.  **ID Único**: Cada card possui um identificador imutável `KB-XXX`.
2.  **Sincronização Obrigatória**: Qualquer mudança de pasta física (ex: Pendente -> Em_Andamento) exige a atualização do status no `mapa_problemas_sistema.md`.
3.  **Foco em Críticos**: É proibido iniciar um novo card crítico sem antes fechar ou pausar explicitamente o crítico atual.
4.  **Evidência de Pronto**: Nenhum card é movido para `Concluido/` sem prova objetiva (ex: sucesso em `npm test`, logs de compilação ou validação de runtime).
5.  **Tooling (Scripts)**: Utilize scripts em TypeScript (ex: `scripts/kanban-check.ts`) para validar se existem IDs duplicados ou se o Mapa Geral está dessincronizado com as pastas físicas.

---

## ▶️ Execução do Checker
- `npm.cmd run kanban:check`: valida IDs duplicados, falta de evidência em concluídos e aponta dessincronização com o mapa como aviso.
- `npm.cmd run kanban:check:strict`: eleva dessincronização com o mapa para erro e retorna falha no processo.

---

## 📈 Escalabilidade
* **Arquivamento**: Quando o arquivo `Concluido/concluido.md` exceder um tamanho prático de leitura, os itens antigos devem ser movidos para arquivos datados (ex: `concluidos_2026_04.md`) dentro da pasta de histórico.
