# Configuração de Sudo para IalClaw

Este documento explica como configurar o sistema para permitir execução de comandos privilegiados pelo agente IalClaw de forma automática e não interativa.

## Visão Geral

O IalClaw pode detectar automaticamente comandos que requerem privilégios elevados (sudo) e executá-los de forma não interativa. Para isso funcionar sem solicitar senha, é necessário configurar o sudo adequadamente.

## Configuração Manual

### Passo 1: Editar sudoers

Abra o editor de configuração do sudoers:

```bash
sudo visudo
```

### Passo 2: Adicionar regra restritiva

Adicione a seguinte linha no final do arquivo (substitua `your_user` pelo seu usuário):

```
your_user ALL=(ALL) NOPASSWD: /usr/bin/apt, /usr/bin/apt-get
```

Esta regra permite que o usuário `your_user` execute apenas `apt` e `apt-get` sem senha.

### Passo 3: Comandos adicionais (opcional)

Para permitir mais comandos, adicione-os separados por vírgula:

```
your_user ALL=(ALL) NOPASSWD: /usr/bin/apt, /usr/bin/apt-get, /usr/bin/pip, /usr/bin/pip3
```

## Gerenciadores de Pacotes Suportados

O sistema detecta automaticamente os seguintes gerenciadores de pacotes:

| Gerenciador | Flag Não Interativa |
|-------------|---------------------|
| apt         | -y                  |
| apt-get     | -y                  |
| yum         | -y                  |
| dnf         | -y                  |
| pacman      | --noconfirm         |
| apk         | --no-interactive   |

## Exemplos de Comandos

### Instalação de pacote (detectado automaticamente)

**Entrada do usuário:**
```
Instale o ffmpeg
```

**Comando gerado:**
```bash
sudo -n apt install -y ffmpeg
```

### Atualização de sistema (detectado automaticamente)

**Entrada do usuário:**
```
Atualize os pacotes do sistema
```

**Comando gerado:**
```bash
sudo -n apt update
```

## Teste Manual

Para testar se a configuração está correta, execute:

```bash
sudo -n apt install -y ffmpeg
```

**Resultado esperado:**
- O comando executa sem pedir senha
- OU falha com erro de permissão (sem travar)

Se pedir senha, a configuração precisa ser ajustada.

## Avisos de Segurança

### NÃO use esta configuração:

```
your_user ALL=(ALL) NOPASSWD: ALL
```

Esta regra permite **qualquer comando** sem senha, o que é extremamente perigoso.

### Riesgos de usar NOPASSWD: ALL

1. **Acesso completo ao sistema**: Qualquer comando pode ser executado
2. **Escabilidade limitada**: Usuários mal-intencionados podem explorar
3. **Sem rastro de auditoria**: Comandos são executados sem confirmação

### Melhor prática

- Liste apenas os comandos necessários
- Use caminhos absolutos
- Revise regularmente as permissões

## Resolução de Problemas

### "Comando requer senha sudo"

**Causa:** O usuário não tem permissão NOPASSWD configurada.

**Solução:**
1. Execute `sudo visudo`
2. Adicione a regra para seu usuário
3. Teste com `sudo -n <comando>`

### "Senha incorreta"

**Causa:** A senha fornecida está incorreta.

**Solução:**
1. Configure NOPASSWD no sudoers
2. Ou forneça a senha correta no parâmetro `password`

### Sistema trava esperando input

**Causa:** O comando está esperando interação do usuário.

**Solução:**
1. O sistema adiciona automaticamente flags não interativas
2. Se ainda travar, configure NOPASSWD no sudoers
3. Verifique os logs em `logs/ialclaw.log`

## Logs de Execução

O sistema gera os seguintes logs relacionados a sudo:

- `log.execution.sudo_detected` - Comando privilegiado detectado
- `log.execution.sudo_non_interactive_applied` - Modo não interativo aplicado
- `log.execution.sudo_failed_non_interactive` - Falha em execução não interativa

Verifique estes eventos em `logs/ialclaw.log` para diagnóstico.

## Fluxo de Decisão

1. **Detecção**: Sistema detecta automaticamente se comando requer sudo
2. **Transformação**: Converte para `sudo -n` com flags não interativas
3. **Execução**: Executa sem esperar input
4. **Fallback**: Se falhar, retorna erro estruturado (não trava)

Este fluxo garante que o sistema nunca bloqueie esperando input do usuário.
