// Company-owned API executable. Recipes are data; caller OAuth owns every data operation.
const HPS_PROTOCOL = 'hps-email-v1';
const HPS_RELEASE_ID = 'hps-email-20261014-v1';
const MAX_RECIPIENTS = 20;

function hpsSharedPreview(input) { return hpsSharedCall_(input, 'preview'); }
function hpsSharedSendApproved(input) { return hpsSharedCall_(input, 'send'); }
function hpsSharedGetSendStatus(input) { return hpsSharedCall_(input, 'status'); }

function hpsSharedCall_(input, operation) {
  try { return hpsSharedDispatch_(input, operation); }
  catch (error) {
    var safe = ['RUNNER_BINDING_MISMATCH','INVALID_RECIPE','RECIPE_DIGEST_MISMATCH','RUNNER_NOT_CONFIGURED','IDENTITY_UNAVAILABLE','CALLER_NOT_ALLOWED','INVALID_PAYLOAD','INVALID_PREVIEW','INVALID_SHEET','INVALID_HEADERS','EMPTY_FIELD','INVALID_MESSAGE_IDS','APPROVAL_REQUIRED','STALE_PREVIEW','LEDGER_CAPACITY','GOOGLE_REQUEST_FAILED','INVALID_GOOGLE_RESPONSE'];
    // Never surface provider exceptions, URLs, tokens, sheet content or account identifiers.
    throw new Error(error && safe.indexOf(error.message) !== -1 ? error.message : 'RUNNER_UNAVAILABLE');
  }
}

function hpsExact_(value, keys) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && Object.keys(value).every(function(key) { return keys.indexOf(key) !== -1; });
}
function hpsRecipe_(value) {
  if (!hpsExact_(value, ['schema','title','description','category','subjectTemplate','bodyTemplate','columns']) || value.schema !== 'hps-email-automation/1' || value.category !== 'email') throw new Error('INVALID_RECIPE');
  [['title',120],['description',1000],['subjectTemplate',240],['bodyTemplate',10000]].forEach(function(rule) {
    var text = value[rule[0]];
    if (typeof text !== 'string' || !text.trim() || text.length > rule[1] || /[\x00]/.test(text)) throw new Error('INVALID_RECIPE');
  });
  if (/[\r\n]/.test(value.subjectTemplate) || !hpsExact_(value.columns, ['email','name','document','dueDate'])) throw new Error('INVALID_RECIPE');
  ['email','name','document','dueDate'].forEach(function(key) {
    var column = value.columns[key];
    if (typeof column !== 'string' || !column.trim() || column.length > 120 || /[\r\n\x00]/.test(column)) throw new Error('INVALID_RECIPE');
  });
  ['subjectTemplate','bodyTemplate'].forEach(function(key) {
    if (/\{\{|\}\}/.test(value[key].replace(/\{\{(name|document|dueDate)\}\}/g, ''))) throw new Error('INVALID_RECIPE');
  });
  // Fixed key order survives Apps Script API's unordered maps.
  var canonical = { schema: value.schema, title: value.title, description: value.description, category: value.category,
    subjectTemplate: value.subjectTemplate, bodyTemplate: value.bodyTemplate,
    columns: { email: value.columns.email, name: value.columns.name, document: value.columns.document, dueDate: value.columns.dueDate } };
  if (Utilities.newBlob(JSON.stringify(canonical)).getBytes().length > 32768) throw new Error('INVALID_RECIPE');
  return canonical;
}
function hpsSharedDispatch_(input, operation) {
  if (!hpsExact_(input, ['protocol','releaseId','accountId','recipe','recipeDigest','payload']) || input.protocol !== HPS_PROTOCOL || input.releaseId !== HPS_RELEASE_ID || typeof input.accountId !== 'string' || !/^[a-f0-9]{64}$/.test(input.accountId)) throw new Error('RUNNER_BINDING_MISMATCH');
  var recipe = hpsRecipe_(input.recipe), digest = hpsHash_(JSON.stringify(recipe));
  if (input.recipeDigest !== digest) throw new Error('RECIPE_DIGEST_MISMATCH');
  var allowed;
  try { allowed = JSON.parse(PropertiesService.getScriptProperties().getProperty('HPS_SHARED_ALLOWED_SUB_SHA256') || 'null'); } catch (_) { throw new Error('RUNNER_NOT_CONFIGURED'); }
  if (!Array.isArray(allowed) || !allowed.length || allowed.length > 20 || new Set(allowed).size !== allowed.length || allowed.some(function(id) { return typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id); })) throw new Error('RUNNER_NOT_CONFIGURED');
  var identity = hpsJson_('https://openidconnect.googleapis.com/v1/userinfo');
  if (!identity || typeof identity.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(identity.sub)) throw new Error('IDENTITY_UNAVAILABLE');
  var accountId = hpsHash_(identity.sub);
  if (accountId !== input.accountId || allowed.indexOf(accountId) === -1) throw new Error('CALLER_NOT_ALLOWED');
  var context = { recipe: recipe, binding: hpsHash_(JSON.stringify([HPS_PROTOCOL,HPS_RELEASE_ID,accountId,digest])) };
  var keys = operation === 'preview' ? ['spreadsheetId','range'] : operation === 'send' ? ['approved','previewId','messages'] : ['ids'];
  if (!hpsExact_(input.payload, keys)) throw new Error('INVALID_PAYLOAD');
  var result = operation === 'preview' ? hpsPreview_(input.payload, context) : operation === 'send' ? hpsSendApproved_(input.payload, context) : hpsGetSendStatus_(input.payload);
  return { protocol: HPS_PROTOCOL, releaseId: HPS_RELEASE_ID, accountId: accountId, recipeDigest: digest, result: result };
}

function hpsHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function hpsMessagesDigest_(messages) {
  // Apps Script API transports objects as unordered maps. Bind ordered values,
  // including recipient case and message order, rather than object key order.
  return hpsHash_(JSON.stringify(messages.map(function(m) { return [m.id, m.to, m.subject, m.body]; })));
}
function hpsJson_(url, options) {
  var response = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true, followRedirects: false, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }, options || {}));
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('GOOGLE_REQUEST_FAILED');
  if (response.getContentText().length > 1000000) throw new Error('INVALID_GOOGLE_RESPONSE');
  return JSON.parse(response.getContentText());
}
function hpsValidateMessages_(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_RECIPIENTS) throw new Error('INVALID_PREVIEW');
  var seen = {};
  messages.forEach(function(m) {
    if (!m || typeof m.to !== 'string' || !/^[A-Za-z0-9.!#$%&'*+\/=?^_\x60{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(m.to) || typeof m.subject !== 'string' || /[\r\n\x00]/.test(m.subject) || m.subject.length > 998 || typeof m.body !== 'string' || m.body.length > 100000 || /\x00/.test(m.body) || seen[m.to.toLowerCase()]) throw new Error('INVALID_PREVIEW');
    seen[m.to.toLowerCase()] = true;
    if (m.id !== hpsHash_(JSON.stringify([m.to.toLowerCase(), m.subject, m.body]))) throw new Error('INVALID_PREVIEW');
  });
}
function hpsPreview_(input, context) {
  if (!input || typeof input.spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(input.spreadsheetId) || typeof input.range !== 'string' || !input.range.trim() || input.range.length > 200 || /[\x00-\x1f]/.test(input.range)) throw new Error('INVALID_SHEET');
  var data = hpsJson_('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(input.spreadsheetId) + '/values/' + encodeURIComponent(input.range) + '?valueRenderOption=FORMATTED_VALUE');
  var rows = data.values;
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > MAX_RECIPIENTS + 1 || rows.some(function(row) { return !Array.isArray(row) || row.length > 100 || row.some(function(cell) { return typeof cell !== 'string' || cell.length > 10000 || /\x00/.test(cell); }); })) throw new Error('INVALID_SHEET');
  var keys = ['email', 'name', 'document', 'dueDate'], indexes = {};
  keys.forEach(function(key) {
    if (rows[0].filter(function(header) { return header === context.recipe.columns[key]; }).length !== 1) throw new Error('INVALID_HEADERS');
    indexes[key] = rows[0].indexOf(context.recipe.columns[key]);
  });
  var messages = rows.slice(1).filter(function(row) { return row.some(function(cell) { return cell.trim(); }); }).map(function(row) {
    var fields = {};
    keys.forEach(function(key) { fields[key] = (row[indexes[key]] || '').trim(); if (!fields[key]) throw new Error('EMPTY_FIELD'); });
    function render(template) { return template.replace(/\{\{(name|document|dueDate)\}\}/g, function(_, key) { return fields[key]; }); }
    var subject = render(context.recipe.subjectTemplate), body = render(context.recipe.bodyTemplate);
    return { id: hpsHash_(JSON.stringify([fields.email.toLowerCase(), subject, body])), to: fields.email, subject: subject, body: body };
  });
  hpsValidateMessages_(messages);
  var createdAt = Date.now(), id = Utilities.getUuid();
  var lock = LockService.getUserLock(); lock.waitLock(10000);
  try {
    PropertiesService.getUserProperties().setProperty('hps.currentPreview', JSON.stringify({ id: id, createdAt: createdAt, digest: hpsMessagesDigest_(messages), binding: context.binding }));
  } finally { lock.releaseLock(); }
  return { id: id, createdAt: createdAt, messages: messages };
}
function hpsRaw_(m) {
  var parts = [], current = '';
  Array.from(m.subject).forEach(function(char) {
    if (Utilities.newBlob(current + char).getBytes().length > 42) { parts.push(current); current = ''; }
    current += char;
  });
  if (current) parts.push(current);
  var subject = parts.map(function(part) { return '=?UTF-8?B?' + Utilities.base64Encode(part, Utilities.Charset.UTF_8) + '?='; }).join('\r\n ');
  var body = Utilities.base64Encode(m.body, Utilities.Charset.UTF_8).match(/.{1,76}/g) || [];
  return Utilities.base64EncodeWebSafe('To: ' + m.to + '\r\nSubject: ' + subject + '\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + body.join('\r\n') + '\r\n', Utilities.Charset.UTF_8).replace(/=+$/, '');
}
function hpsGetSendStatus_(input) {
  if (!input || !Array.isArray(input.ids) || !input.ids.length || input.ids.length > MAX_RECIPIENTS || input.ids.some(function(id) { return typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id); }) || new Set(input.ids).size !== input.ids.length) throw new Error('INVALID_MESSAGE_IDS');
  var lock = LockService.getUserLock(); lock.waitLock(10000);
  try {
    var properties = PropertiesService.getUserProperties();
    return { records: input.ids.map(function(id) {
      var value = properties.getProperty('hps.sent.' + id);
      return { id: id, status: value == null ? 'not_attempted' : value === 'sent' ? 'sent' : 'unknown' };
    }) };
  } finally { lock.releaseLock(); }
}
function hpsSendApproved_(input, context) {
  if (!input || input.approved !== true) throw new Error('APPROVAL_REQUIRED');
  hpsValidateMessages_(input.messages);
  var lock = LockService.getUserLock(); lock.waitLock(10000);
  try {
    var properties = PropertiesService.getUserProperties();
    var preview = JSON.parse(properties.getProperty('hps.currentPreview') || 'null');
    if (!preview || preview.binding !== context.binding || preview.id !== input.previewId || !Number.isFinite(preview.createdAt) || Date.now() < preview.createdAt || Date.now() - preview.createdAt > 1800000 || preview.digest !== hpsMessagesDigest_(input.messages)) throw new Error('STALE_PREVIEW');
    var records = [];
    for (var i = 0; i < input.messages.length; i++) {
      var m = input.messages[i], key = 'hps.sent.' + m.id, old = properties.getProperty(key);
      if (old) { records.push({ id: m.id, status: old === 'sent' ? 'sent' : 'unknown' }); continue; }
      // Keep durable uncertainty rather than evicting records and risking duplicate mail.
      if (Object.keys(properties.getProperties()).length >= 2000) throw new Error('LEDGER_CAPACITY');
      properties.setProperty(key, 'unknown');
      var status = 'unknown';
      try {
        var result = hpsJson_('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ raw: hpsRaw_(m) }) });
        if (result && typeof result.id === 'string' && result.id) { properties.setProperty(key, 'sent'); status = 'sent'; }
      } catch (_) { /* Google may have accepted mail before a transport failure. Never retry automatically. */ }
      records.push({ id: m.id, status: status });
      if (status !== 'sent') break;
    }
    return { records: records };
  } finally { lock.releaseLock(); }
}