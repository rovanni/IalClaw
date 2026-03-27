(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }

  root.IalclawDashboardUiCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CHAT_TYPES = new Set(['user', 'final']);

  function normalizeEventType(type) {
    return String(type || '').trim().toLowerCase();
  }

  function getEventChannel(type) {
    return CHAT_TYPES.has(normalizeEventType(type)) ? 'chat' : 'log';
  }

  function getActionButtonState(isProcessing) {
    return isProcessing
      ? {
          label: 'Parar',
          title: 'Interromper execução',
          action: 'stop',
          className: 'is-stop'
        }
      : {
          label: 'Enviar',
          title: 'Enviar mensagem',
          action: 'send',
          className: ''
        };
  }

  return {
    normalizeEventType,
    getEventChannel,
    getActionButtonState
  };
});