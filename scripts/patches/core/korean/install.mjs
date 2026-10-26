// Generate the same flat NLS format as VS Code's language-pack loader, before signing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const translations = JSON.parse(fs.readFileSync(path.join(here, 'main.i18n.json'), 'utf8')).contents;
for (const [module, values] of Object.entries(JSON.parse(fs.readFileSync(path.join(here, 'overrides.json'), 'utf8')))) {
  translations[module] = { ...translations[module], ...values };
}
export function translate(keys, messages, catalog = translations) {
  if (!Array.isArray(keys) || !Array.isArray(messages)) throw new Error('Invalid NLS metadata');
  const result = [], missing = [];
  for (const [module, names] of keys) {
    for (const key of names) {
      const original = messages[result.length];
      if (typeof original !== 'string') throw new Error('NLS key/message mismatch');
      let translated = catalog[module]?.[key];
      // Never silently ship an untranslated native menu/dialog/update label.
      const critical = /(?:menubar|\/dialogs\/|\/update\/)/.test(module);
      if (critical && !translated && /[a-zA-Z]/.test(original) && !/[가-힣]/.test(original)) missing.push(`${module}:${key}`);
      if (translated) {
        const tokens = s => [...s.matchAll(/\{\d+\}/g)].map(m => m[0]).sort().join(',');
        if (tokens(translated) !== tokens(original)) {
          if (critical) throw new Error(`NLS placeholder mismatch: ${module}:${key}`);
          translated = undefined; // An unrelated upstream key changed meaning; keep its default.
        }
      }
      result.push(translated || original);
    }
  }
  if (result.length !== messages.length) throw new Error('NLS key/message mismatch');
  if (missing.length) throw new Error(`Missing Korean shell translations: ${missing.join(', ')}`);
  return result;
}
export function install(app) {
  const out = path.join(app, 'out');
  const read = name => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
  const messages = translate(read('nls.keys.json'), read('nls.messages.json'));
  fs.writeFileSync(path.join(out, 'nls.messages.ko.json'), JSON.stringify(messages));
  return messages.length;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: install.mjs <packaged resources/app>');
  console.log(`Installed ${install(process.argv[2])} Korean shell messages`);
}
