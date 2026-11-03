// Pure static alias expansion for existing render/geometry tests.
export function staticTokens(css) {
  const entries = [...css.matchAll(/(--ds-[\w-]+)\s*:\s*([^;{}]+);/g)];
  const values = new Map();
  for (const [,name,value] of entries) {
    if (values.has(name) && values.get(name) !== value.trim()) throw new Error(`Theme-dependent token ${name}: use a browser probe`);
    values.set(name, value.trim());
  }
  function resolve(name, seen = new Set()) {
    if (seen.has(name) || !values.has(name)) throw new Error(`Unresolved/cyclic design token ${name}`);
    return values.get(name).replace(/var\((--ds-[\w-]+)\)/g, (_, next) => resolve(next, new Set([...seen, name])));
  }
  return (text) => text.replace(/var\((--ds-[\w-]+)\)/g, (_, name) => resolve(name));
}
