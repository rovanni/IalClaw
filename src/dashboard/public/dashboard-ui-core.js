(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }

  root.IalclawDashboardUiCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CHAT_TYPES = new Set(['user', 'final']);
  const i18n = typeof globalThis !== 'undefined' ? globalThis.IalclawDashboardI18n : null;

  function t(key, fallback) {
    if (!i18n || typeof i18n.t !== 'function') return fallback;
    return i18n.t(key, undefined, fallback);
  }

  function normalizeEventType(type) {
    return String(type || '').trim().toLowerCase();
  }

  function getEventChannel(type) {
    return CHAT_TYPES.has(normalizeEventType(type)) ? 'chat' : 'log';
  }

  function getActionButtonState(isProcessing) {
    return isProcessing
      ? {
          label: t('dashboard.action.stop', 'Stop'),
          title: t('dashboard.action.stop_title', 'Stop execution'),
          action: 'stop',
          className: 'is-stop'
        }
      : {
          label: t('dashboard.action.send', 'Send'),
          title: t('dashboard.action.send_title', 'Send message'),
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
