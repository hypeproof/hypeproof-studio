// Package the already installed, lock-verified SDK JS closure for an isolated
// development copy. Uses the release vendor layout; native binaries stay seeded.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
export function vendorManifest(root) {
  const files = [];
  const visit = (dir) => { for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw Error('Vendor symlinks are not accepted');
    if (stat.isDirectory()) visit(file);
    else if (stat.isFile()) {
      if (stat.size > 50 * 1024 * 1024) throw Error('Oversized SDK vendor file');
      files.push([path.relative(root, file).split(path.sep).join('/'), hash(fs.readFileSync(file))]);
    } else throw Error('Unsupported vendor file type');
  }};
  visit(root);
  return {sha256: hash(JSON.stringify(files)), file_count: files.length};
}
export async function prepareVendor(extension, destination) {
  if (fs.existsSync(destination)) throw Error('New owned vendor directory required');
  const lock = JSON.parse(fs.readFileSync(path.join(extension, 'package-lock.json')));
  const source = JSON.parse(fs.readFileSync(path.join(extension, 'package.json')));
  const declared = source.dependencies?.['@anthropic-ai/claude-agent-sdk'] ?? source.devDependencies?.['@anthropic-ai/claude-agent-sdk'];
  if (declared !== lock.packages?.['node_modules/@anthropic-ai/claude-agent-sdk']?.version) throw Error('Source SDK declaration and lock version differ');
  const modules = fs.realpathSync(path.join(extension, 'node_modules'));
  const copied = new Map();
  function copy(name, from) {
    if (name.startsWith('@anthropic-ai/claude-agent-sdk-')) throw Error('Native SDK binary cannot be vendored');
    const require = createRequire(from);
    let dir = path.dirname(require.resolve(name));
    while (!fs.existsSync(path.join(dir, 'package.json')) || JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).name !== name) {
      const parent = path.dirname(dir); if (parent === dir) throw Error('Package root missing'); dir = parent;
    }
    dir = fs.realpathSync(dir);
    const relative = path.relative(modules, dir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Runtime package must belong to installed extension dependencies');
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')));
    const key = 'node_modules/' + relative.split(path.sep).join('/');
    if (lock.packages?.[key]?.version !== pkg.version) throw Error('Installed SDK closure differs from lockfile: ' + name);
    if (copied.has(name)) {
      if (copied.get(name) !== pkg.version) throw Error('Conflicting runtime dependency versions: ' + name);
      return;
    }
    copied.set(name, pkg.version);
    const target = path.join(destination, 'node_modules', name);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.cpSync(dir, target, {recursive: true, filter: source => path.basename(source) !== 'node_modules'});
    for (const dep of Object.keys(pkg.dependencies ?? {})) if (!(dep in (pkg.optionalDependencies ?? {}))) copy(dep, path.join(dir, 'package.json'));
  }
  for (const name of ['@anthropic-ai/claude-agent-sdk', 'zod']) copy(name, path.join(extension, 'package.json'));
  // Import from the copied tree, never the source node_modules, to prove the
  // runtime closure used by loadSdk/loadZod is complete without calling a model.
  const sdk = await import(pathToFileURL(path.join(destination, 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs')).href);
  const zod = await import(pathToFileURL(path.join(destination, 'node_modules/zod/index.js')).href);
  if (typeof sdk.query !== 'function' || typeof sdk.createSdkMcpServer !== 'function' || typeof zod.z?.object !== 'function') throw Error('Incomplete vendored SDK/MCP runtime');
  return {schema: 'hps-dev-sdk-vendor/1', packages: Object.fromEntries(copied), ...vendorManifest(destination)};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [extension, destination, receipt] = process.argv.slice(2);
  if (![extension, destination, receipt].every(value => value && path.isAbsolute(value))) throw Error('Explicit absolute source, destination and receipt required');
  fs.writeFileSync(receipt, JSON.stringify(await prepareVendor(extension, destination), null, 2));
}
