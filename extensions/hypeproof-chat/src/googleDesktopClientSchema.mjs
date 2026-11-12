// Native Desktop client identification is distributable; user tokens never are.
export const GOOGLE_DESKTOP_RESOURCE = 'google-desktop-client.json';
const fail = () => { throw new Error('Google Desktop client configuration is invalid.'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
function credentials(clientId, clientSecret) {
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{1,200}\.apps\.googleusercontent\.com$/.test(clientId)) fail();
  if (typeof clientSecret !== 'string' || !/^[A-Za-z0-9_-]{8,256}$/.test(clientSecret) || /^(ya29|eyJ)/.test(clientSecret)) fail();
  return { schema: 'hps-google-desktop/1', clientId, clientSecret };
}
export function parseGoogleDesktopSource(text) {
  try {
    if (Buffer.byteLength(text) > 16384) fail();
    const source = JSON.parse(text);
    if (!exact(source, ['installed']) || !source.installed) fail();
    const value = source.installed;
    if (!exact(value, ['client_id','client_secret','project_id','auth_uri','token_uri','auth_provider_x509_cert_url','redirect_uris'])) fail();
    for (const key of ['project_id','auth_uri','token_uri','auth_provider_x509_cert_url']) if (value[key] !== undefined && typeof value[key] !== 'string') fail();
    if (value.auth_uri !== undefined && value.auth_uri !== 'https://accounts.google.com/o/oauth2/auth' && value.auth_uri !== 'https://accounts.google.com/o/oauth2/v2/auth') fail();
    if (value.token_uri !== undefined && value.token_uri !== 'https://oauth2.googleapis.com/token') fail();
    if (!Array.isArray(value.redirect_uris) || !value.redirect_uris.length || value.redirect_uris.some(uri => !['http://localhost','http://127.0.0.1','http://[::1]'].includes(uri))) fail();
    return credentials(value.client_id, value.client_secret);
  } catch { return fail(); }
}
export function parsePackagedGoogleDesktop(text, expectedClientId) {
  try {
    if (Buffer.byteLength(text) > 8192) fail();
    const value = JSON.parse(text);
    if (!exact(value, ['schema','clientId','clientSecret']) || value.schema !== 'hps-google-desktop/1' || value.clientId !== expectedClientId) fail();
    return credentials(value.clientId, value.clientSecret);
  } catch { return fail(); }
}
