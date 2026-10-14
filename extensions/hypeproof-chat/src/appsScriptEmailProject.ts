import { createHash } from 'node:crypto';
import { validateEmailRecipe, type EmailRecipe } from './googleAutomation.ts';

export const APPS_SCRIPT_EXECUTION_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/script.external_request',
] as const;
export interface AppsScriptFile { name: string; type: 'SERVER_JS' | 'JSON'; source: string }
export interface AppsScriptEmailProject { files: AppsScriptFile[]; digest: string; scopes: readonly string[] }
const generatedProjects = new WeakMap<object, string>();
export function assertGeneratedAppsScriptProject(project: AppsScriptEmailProject): void {
  if (generatedProjects.get(project) !== project.digest || project.digest !== appsScriptContentDigest(project.files)) throw new Error('승인할 코드를 다시 만들어 주세요.');
}
export function appsScriptContentDigest(files: readonly AppsScriptFile[]): string {
  return createHash('sha256').update(JSON.stringify(files.map(({ name, type, source }) => ({ name, type, source })).sort((a, b) => a.name.localeCompare(b.name)))).digest('hex');
}

/** Only validated email templates enter source. Sheet identifiers and recipients are runtime parameters. */
export function generateAppsScriptEmailProject(value: EmailRecipe, maxRecipients = 20): AppsScriptEmailProject {
  const recipe = validateEmailRecipe(value);
  if (!Number.isInteger(maxRecipients) || maxRecipients < 1 || maxRecipients > 20) throw new Error('수신자는 최대 20명까지 지원해요.');
  const source = `const RECIPE = ${JSON.stringify(recipe)};\nconst MAX_RECIPIENTS = ${maxRecipients};\n` + String.raw`
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
function hpsPreview(input) {
  if (!input || typeof input.spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(input.spreadsheetId) || typeof input.range !== 'string' || !input.range.trim() || input.range.length > 200 || /[\x00-\x1f]/.test(input.range)) throw new Error('INVALID_SHEET');
  var data = hpsJson_('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(input.spreadsheetId) + '/values/' + encodeURIComponent(input.range) + '?valueRenderOption=FORMATTED_VALUE');
  var rows = data.values;
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > MAX_RECIPIENTS + 1 || rows.some(function(row) { return !Array.isArray(row) || row.length > 100 || row.some(function(cell) { return typeof cell !== 'string' || cell.length > 10000 || /\x00/.test(cell); }); })) throw new Error('INVALID_SHEET');
  var keys = ['email', 'name', 'document', 'dueDate'], indexes = {};
  keys.forEach(function(key) {
    if (rows[0].filter(function(header) { return header === RECIPE.columns[key]; }).length !== 1) throw new Error('INVALID_HEADERS');
    indexes[key] = rows[0].indexOf(RECIPE.columns[key]);
  });
  var messages = rows.slice(1).filter(function(row) { return row.some(function(cell) { return cell.trim(); }); }).map(function(row) {
    var fields = {};
    keys.forEach(function(key) { fields[key] = (row[indexes[key]] || '').trim(); if (!fields[key]) throw new Error('EMPTY_FIELD'); });
    function render(template) { return template.replace(/\{\{(name|document|dueDate)\}\}/g, function(_, key) { return fields[key]; }); }
    var subject = render(RECIPE.subjectTemplate), body = render(RECIPE.bodyTemplate);
    return { id: hpsHash_(JSON.stringify([fields.email.toLowerCase(), subject, body])), to: fields.email, subject: subject, body: body };
  });
  hpsValidateMessages_(messages);
  var createdAt = Date.now(), id = Utilities.getUuid();
  var lock = LockService.getUserLock(); lock.waitLock(10000);
  try {
    PropertiesService.getUserProperties().setProperty('hps.currentPreview', JSON.stringify({ id: id, createdAt: createdAt, digest: hpsMessagesDigest_(messages) }));
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
function hpsSendApproved(input) {
  if (!input || input.approved !== true) throw new Error('APPROVAL_REQUIRED');
  hpsValidateMessages_(input.messages);
  var lock = LockService.getUserLock(); lock.waitLock(10000);
  try {
    var properties = PropertiesService.getUserProperties();
    var preview = JSON.parse(properties.getProperty('hps.currentPreview') || 'null');
    if (!preview || preview.id !== input.previewId || Date.now() - preview.createdAt > 1800000 || preview.digest !== hpsMessagesDigest_(input.messages)) throw new Error('STALE_PREVIEW');
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
`;
  const files: AppsScriptFile[] = [
    { name: 'appsscript', type: 'JSON', source: JSON.stringify({ timeZone: 'Asia/Seoul', runtimeVersion: 'V8', exceptionLogging: 'NONE', executionApi: { access: 'MYSELF' }, oauthScopes: APPS_SCRIPT_EXECUTION_SCOPES, urlFetchWhitelist: ['https://sheets.googleapis.com/', 'https://gmail.googleapis.com/'] }, null, 2) },
    { name: 'Code', type: 'SERVER_JS', source },
  ];
  const project = { files, digest: appsScriptContentDigest(files), scopes: APPS_SCRIPT_EXECUTION_SCOPES };
  generatedProjects.set(project, project.digest);
  return project;
}
