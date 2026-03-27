(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }

  root.IalclawDashboardI18n = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FALLBACK = 'en-US';
  const SUPPORTED = new Set(['pt-BR', 'en-US']);

  const DICTIONARY = {
    'pt-BR': {
      'dashboard.input.placeholder': 'Pergunte, descreva ou cole sua tarefa...',
      'dashboard.button.new_chat': '+ Nova conversa',
      'dashboard.button.memory': 'Memoria',
      'dashboard.button.help': 'Ajuda',
      'dashboard.button.simple_mode': 'Modo simples',
      'dashboard.conversation.loading': 'Carregando historico...',
      'dashboard.language.label': 'Idioma',
      'dashboard.language.portuguese': 'Portugues',
      'dashboard.language.english': 'English',
      'dashboard.action.send': 'Enviar',
      'dashboard.action.send_title': 'Enviar mensagem',
      'dashboard.action.stop': 'Parar',
      'dashboard.action.stop_title': 'Interromper execução',
      'dashboard.theme.dark': 'Escuro',
      'dashboard.theme.light': 'Claro',
      'dashboard.status.ready': 'Pronto',
      'dashboard.status.error': 'Erro',
      'dashboard.status.stopped': 'Interrompido',
      'dashboard.status.reconnecting': 'Reconectando status...',
      'dashboard.typing.thinking': 'IalClaw esta pensando...',
      'dashboard.typing.processing': '[SYSTEM] processando...',
      'dashboard.typing.preparing': '[SYSTEM] Preparando execucao...',
      'dashboard.typing.stopping': '[SYSTEM] Interrompendo execucao...',
      'dashboard.session.active': 'Sessao ativa: {sessionId}',
      'dashboard.session.channel_ready': 'Canal de status pronto para progresso interno.',
      'dashboard.http.failed': 'Falha HTTP {status}',
      'dashboard.error.invalid_response': 'Resposta invalida',
      'dashboard.error.history_load': 'Nao foi possivel carregar o historico.',
      'dashboard.error.empty_history': 'Historico vazio. Digite um comando cognitivo.',
      'dashboard.error.empty_response': 'Resposta vazia do backend.',
      'dashboard.error.speech_not_supported': 'Web Speech API nao suportada neste navegador.',
      'dashboard.error.speech_failed': 'Falha no reconhecimento de voz: {error}',
      'dashboard.error.trace_replay': 'Erro ao reproduzir trace: {error}',
      'dashboard.trace.start': 'Replay do trace {traceId} iniciado...',
      'dashboard.trace.empty': 'Nenhum evento encontrado para este trace.',
      'dashboard.trace.end': 'Replay do trace {traceId} finalizado.',
      'dashboard.mode.updated': 'Modo de execucao alterado para {label}.',
      'dashboard.mode.update_failed': 'Nao foi possivel atualizar o modo: {error}',
      'dashboard.mode.update_failed_simple': 'Nao foi possivel atualizar o modo de execucao: {error}',
      'dashboard.mode.effective': 'Modo efetivo: {mode} | confianca: {confidence}',
      'dashboard.graph.load_failed': 'Falha ao carregar grafo cognitivo.',
      'dashboard.voice.started': 'Captura de voz iniciada.',
      'dashboard.voice.captured': 'Voz capturada: {transcript}',
      'dashboard.voice.reading': 'Leitura por voz {state}.',
      'dashboard.voice.enabled': 'ativada',
      'dashboard.voice.disabled': 'desativada',
      'dashboard.execution.cancelled': 'Execucao interrompida pelo usuario.',
      'dashboard.chat.error': 'Erro ao falar com IalClaw: {error}',
      'dashboard.chat.error_simple': 'Erro ao enviar mensagem: {error}',
      'dashboard.agent.no_response': 'Sem resposta do agente.',
      'dashboard.logs.thought_empty': 'evento thought sem conteudo',
      'dashboard.logs.tool_failed': 'Tool {name} falhou: {status}',
      'dashboard.logs.tool_done': 'Tool {name}: {status} ({latency}ms)',
      'dashboard.logs.rag': 'Nos recuperados: {count} | Top score: {score}',
      'dashboard.logs.gateway': 'Gateway: {summary}',
      'dashboard.logs.exec_summary': 'Resumo de execucao recebido',
      'dashboard.logs.exec_mode': 'Modo {mode} ({stage})',
      'dashboard.logs.tool_input_error': 'Erro de entrada de tool: {tool}',
      'dashboard.logs.self_healing': 'Self-healing {stage} tentativa {attempt}',
      'dashboard.logs.self_healing_abort': 'Self-healing abortado: {reason}',
      'dashboard.logs.agent_status': 'Status de execucao atualizado',
      'dashboard.logs.replay_summary': 'Resumo final de execucao',
      'dashboard.view.trace': 'Ver execucao',
      'dashboard.conversation.no_messages': 'Sem mensagens',
      'dashboard.conversation.msg_count': '{count} msgs',
      'dashboard.logs.tool_history': 'Tool (historico): {content}'
    },
    'en-US': {
      'dashboard.input.placeholder': 'Ask, describe, or paste your task...',
      'dashboard.button.new_chat': '+ New chat',
      'dashboard.button.memory': 'Memory',
      'dashboard.button.help': 'Help',
      'dashboard.button.simple_mode': 'Simple mode',
      'dashboard.conversation.loading': 'Loading history...',
      'dashboard.language.label': 'Language',
      'dashboard.language.portuguese': 'Portuguese',
      'dashboard.language.english': 'English',
      'dashboard.action.send': 'Send',
      'dashboard.action.send_title': 'Send message',
      'dashboard.action.stop': 'Stop',
      'dashboard.action.stop_title': 'Stop execution',
      'dashboard.theme.dark': 'Dark',
      'dashboard.theme.light': 'Light',
      'dashboard.status.ready': 'Ready',
      'dashboard.status.error': 'Error',
      'dashboard.status.stopped': 'Stopped',
      'dashboard.status.reconnecting': 'Reconnecting status...',
      'dashboard.typing.thinking': 'IalClaw is thinking...',
      'dashboard.typing.processing': '[SYSTEM] processing...',
      'dashboard.typing.preparing': '[SYSTEM] Preparing execution...',
      'dashboard.typing.stopping': '[SYSTEM] Stopping execution...',
      'dashboard.session.active': 'Active session: {sessionId}',
      'dashboard.session.channel_ready': 'Status channel ready for internal progress.',
      'dashboard.http.failed': 'HTTP failure {status}',
      'dashboard.error.invalid_response': 'Invalid response',
      'dashboard.error.history_load': 'Could not load history.',
      'dashboard.error.empty_history': 'History is empty. Type a cognitive command.',
      'dashboard.error.empty_response': 'Empty backend response.',
      'dashboard.error.speech_not_supported': 'Web Speech API is not supported in this browser.',
      'dashboard.error.speech_failed': 'Voice recognition failed: {error}',
      'dashboard.error.trace_replay': 'Trace replay failed: {error}',
      'dashboard.trace.start': 'Trace replay {traceId} started...',
      'dashboard.trace.empty': 'No events found for this trace.',
      'dashboard.trace.end': 'Trace replay {traceId} finished.',
      'dashboard.mode.updated': 'Execution mode changed to {label}.',
      'dashboard.mode.update_failed': 'Could not update mode: {error}',
      'dashboard.mode.update_failed_simple': 'Could not update execution mode: {error}',
      'dashboard.mode.effective': 'Effective mode: {mode} | confidence: {confidence}',
      'dashboard.graph.load_failed': 'Failed to load cognitive graph.',
      'dashboard.voice.started': 'Voice capture started.',
      'dashboard.voice.captured': 'Voice captured: {transcript}',
      'dashboard.voice.reading': 'Voice reading {state}.',
      'dashboard.voice.enabled': 'enabled',
      'dashboard.voice.disabled': 'disabled',
      'dashboard.execution.cancelled': 'Execution stopped by user.',
      'dashboard.chat.error': 'Error talking to IalClaw: {error}',
      'dashboard.chat.error_simple': 'Error sending message: {error}',
      'dashboard.agent.no_response': 'No response from agent.',
      'dashboard.logs.thought_empty': 'thought event without content',
      'dashboard.logs.tool_failed': 'Tool {name} failed: {status}',
      'dashboard.logs.tool_done': 'Tool {name}: {status} ({latency}ms)',
      'dashboard.logs.rag': 'Retrieved nodes: {count} | Top score: {score}',
      'dashboard.logs.gateway': 'Gateway: {summary}',
      'dashboard.logs.exec_summary': 'Execution summary received',
      'dashboard.logs.exec_mode': 'Mode {mode} ({stage})',
      'dashboard.logs.tool_input_error': 'Tool input error: {tool}',
      'dashboard.logs.self_healing': 'Self-healing {stage} attempt {attempt}',
      'dashboard.logs.self_healing_abort': 'Self-healing aborted: {reason}',
      'dashboard.logs.agent_status': 'Execution status updated',
      'dashboard.logs.replay_summary': 'Final execution summary',
      'dashboard.view.trace': 'View execution',
      'dashboard.conversation.no_messages': 'No messages',
      'dashboard.conversation.msg_count': '{count} msgs',
      'dashboard.logs.tool_history': 'Tool (history): {content}'
    }
  };

  const STORAGE_KEY = 'ialclaw_lang';
  let language = FALLBACK;
  let initialized = false;

  function normalize(lang) {
    const value = String(lang || '').trim().toLowerCase();
    if (value === 'pt' || value === 'pt-br') return 'pt-BR';
    if (value === 'en' || value === 'en-us') return 'en-US';
    return FALLBACK;
  }

  function interpolate(template, params) {
    if (!params) return template;
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, function (_m, key) {
      const value = params[key];
      return value === undefined || value === null ? '{' + key + '}' : String(value);
    });
  }

  function t(key, params, fallback) {
    const dict = DICTIONARY[language] || {};
    const fallbackDict = DICTIONARY[FALLBACK] || {};
    const template = dict[key] || fallbackDict[key] || fallback || key;
    return interpolate(template, params);
  }

  async function init() {
    if (initialized) return language;

    try {
      const params = new URLSearchParams(window.location.search || '');
      const langQuery = params.get('lang');
      const langStored = window.localStorage.getItem(STORAGE_KEY);
      const preferred = langQuery || langStored || '';
      const url = preferred ? '/api/i18n/language?lang=' + encodeURIComponent(preferred) : '/api/i18n/language';
      const response = await fetch(url);
      const data = await response.json();
      language = normalize(data && data.language);
    } catch (_error) {
      language = normalize(window.navigator && window.navigator.language);
    }

    if (!SUPPORTED.has(language)) {
      language = FALLBACK;
    }

    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch (_error) {}
    initialized = true;
    return language;
  }

  function getLanguage() {
    return language;
  }

  function setLanguage(nextLang) {
    const normalized = normalize(nextLang);
    language = normalized;
    document.documentElement.lang = normalized;
    try {
      window.localStorage.setItem(STORAGE_KEY, normalized);
    } catch (_error) {}
    initialized = true;
    return language;
  }

  return {
    init,
    t,
    getLanguage,
    normalize,
    setLanguage
  };
});
