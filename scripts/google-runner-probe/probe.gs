/** Read-only Google data probe; synthetic state is written only to UserProperties. */
function hpsProbe(input) {
  var lock;
  var locked = false;
  try {
    if (!hpsValidInput_(input)) return { status: 'invalid_input' };
    var allowed = hpsAllowlist_();
    if (!allowed) return { status: 'not_configured' };

    var token = ScriptApp.getOAuthToken();
    var identity = hpsGetJson_('https://openidconnect.googleapis.com/v1/userinfo', token);
    if (identity.status !== 'ok' || !identity.data ||
        typeof identity.data.sub !== 'string' ||
        !/^[A-Za-z0-9_-]{1,255}$/.test(identity.data.sub)) {
      return { status: identity.status === 'quota_exceeded' ? 'quota_exceeded' : 'identity_unavailable' };
    }
    var callerDigest = hpsDigest_(identity.data.sub);
    if (allowed.indexOf(callerDigest) === -1) return { status: 'caller_not_allowed' };

    // Use the executing caller's token, never the owner's credentials or a supplied identity.
    var sheet = hpsGetJson_('https://sheets.googleapis.com/v4/spreadsheets/' +
      encodeURIComponent(input.sheetId) + '/values/A1?valueRenderOption=UNFORMATTED_VALUE', token);
    if (sheet.status !== 'ok') {
      return { status: sheet.status, callerDigest: callerDigest };
    }
    if (!sheet.data || typeof sheet.data !== 'object' || Array.isArray(sheet.data)) {
      return { status: 'invalid_google_response', callerDigest: callerDigest };
    }
    var values = sheet.data.values;
    if (values !== undefined && (!Array.isArray(values) || values.length > 1 ||
        (values.length === 1 && (!Array.isArray(values[0]) || values[0].length > 1)))) {
      return { status: 'invalid_google_response', callerDigest: callerDigest };
    }
    var cell = values && values[0] && values[0].length ? values[0][0] : null;
    if (cell !== null && ['string', 'number', 'boolean'].indexOf(typeof cell) === -1) {
      return { status: 'invalid_google_response', callerDigest: callerDigest };
    }
    var sheetValueDigest = hpsDigest_(JSON.stringify(cell));

    lock = LockService.getUserLock();
    locked = lock.tryLock(1000);
    if (!locked) return { status: 'busy', callerDigest: callerDigest };
    var properties = PropertiesService.getUserProperties();
    var key = 'hps-probe:' + input.namespace;
    var previousMarker = properties.getProperty(key);
    if (previousMarker !== null && !hpsValidMarker_(previousMarker)) {
      return { status: 'invalid_probe_state', callerDigest: callerDigest };
    }
    if (input.marker !== undefined) {
      if (previousMarker === null && Object.keys(properties.getProperties()).filter(function (name) {
        return name.indexOf('hps-probe:') === 0;
      }).length >= 10) return { status: 'probe_state_limit', callerDigest: callerDigest };
      properties.setProperty(key, input.marker);
    }
    return {
      status: 'ok', callerDigest: callerDigest,
      previousMarker: previousMarker,
      currentMarker: input.marker === undefined ? previousMarker : input.marker,
      sheetValueDigest: sheetValueDigest
    };
  } catch (_) {
    // Deliberately omit exception text: Google errors may contain sheet IDs or tokens.
    return { status: 'probe_unavailable' };
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (_) { /* Never expose cleanup exceptions. */ }
    }
  }
}

function hpsValidInput_(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  var keys = Object.keys(input);
  if (keys.some(function (key) { return ['namespace', 'sheetId', 'range', 'marker'].indexOf(key) === -1; })) return false;
  return typeof input.namespace === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(input.namespace) &&
    typeof input.sheetId === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(input.sheetId) &&
    input.range === 'A1' && (input.marker === undefined || hpsValidMarker_(input.marker));
}

function hpsValidMarker_(marker) {
  return typeof marker === 'string' && /^probe-[A-Za-z0-9_-]{1,48}$/.test(marker);
}

function hpsAllowlist_() {
  try {
    var value = JSON.parse(PropertiesService.getScriptProperties().getProperty('HPS_PROBE_SUB_SHA256'));
    return Array.isArray(value) && value.length === 2 && value[0] !== value[1] &&
      value.every(function (digest) { return typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest); }) ? value : null;
  } catch (_) { return null; }
}

function hpsDigest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function hpsGetJson_(url, token) {
  var response = UrlFetchApp.fetch(url, {
    method: 'get', headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true, followRedirects: false
  });
  var code = response.getResponseCode();
  if (code === 429) return { status: 'quota_exceeded' };
  if (code === 403 || code === 404) return { status: 'sheet_access_denied' };
  if (code === 401) return { status: 'authorization_required' };
  if (code !== 200) return { status: 'google_unavailable' };
  var text = response.getContentText();
  if (text.length > 65536) return { status: 'invalid_google_response' };
  try { return { status: 'ok', data: JSON.parse(text) }; }
  catch (_) { return { status: 'invalid_google_response' }; }
}
