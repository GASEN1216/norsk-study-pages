/* Local previews keep isolated scores; both public sites share the same service. */
window.NORSK_COMMUNITY_CONFIG = window.NORSK_COMMUNITY_CONFIG || {
  apiBase: ['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)
    ? '/api/community'
    : 'https://norsk-community.beima.chatgpt.site/api/community'
};
