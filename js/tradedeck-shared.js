(function (global) {
  var API_BASE = 'https://tradedeck-api.onrender.com';

  function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function apiPost(path, getAccessToken, body) {
    var token = await getAccessToken();
    if (!token) {
      var err = new Error('Not signed in');
      err.status = 401;
      throw err;
    }
    var res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var fail = new Error(data.error || res.statusText || 'Request failed');
      fail.status = res.status;
      fail.data = data;
      throw fail;
    }
    return data;
  }

  global.TradeDeck = {
    API_BASE: API_BASE,
    escapeHtml: escapeHtml,
    apiPost: apiPost,
  };
})(window);
