// A minimal DOM, just enough for react-dom/client to mount, update and dispatch clicks in plain
// Node (the repo has no jsdom). Import it before React so react-dom sees a DOM at load time.
// It models nodes, attributes, text, event capture/bubble and simple selectors (tag, .class, #id,
// [attr], [attr="v"], :disabled, :not(:disabled), descendant combinator). There is no layout:
// geometry reads as 0 and scrolling is a no-op.

/** Does `el` match one compound selector such as `button.a[role="menuitem"]:not(:disabled)`? */
function matchesCompound(el, compound) {
  const re = /(:not\(:disabled\))|(:disabled)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|^([\w-]+|\*)/g;
  let m; let consumed = 0;
  while ((m = re.exec(compound)) !== null) {
    if (m[0] === "") { re.lastIndex++; continue; }
    consumed += m[0].length;
    if (m[1] && el.hasAttribute("disabled")) return false;
    if (m[2] && !el.hasAttribute("disabled")) return false;
    if (m[3] && !(el.getAttribute("class") ?? "").split(/\s+/).includes(m[3])) return false;
    if (m[4] && el.getAttribute("id") !== m[4]) return false;
    if (m[5] && (m[6] === undefined ? !el.hasAttribute(m[5]) : el.getAttribute(m[5]) !== m[6])) return false;
    if (m[7] && m[7] !== "*" && el.localName.toLowerCase() !== m[7].toLowerCase()) return false;
  }
  if (consumed !== compound.length) throw new Error(`mini-dom: unsupported selector "${compound}"`);
  return true;
}
function matchesSelector(el, selector) {
  return selector.split(",").some((one) => {
    const parts = one.trim().split(/\s+/);
    if (!matchesCompound(el, parts[parts.length - 1])) return false;
    let i = parts.length - 2;
    for (let n = el.parentNode; n && i >= 0; n = n.parentNode) if (n.nodeType === 1 && matchesCompound(n, parts[i])) i--;
    return i < 0;
  });
}

class Node {
  constructor(nodeType, nodeName, ownerDocument) {
    this.nodeType = nodeType; this.nodeName = nodeName; this.ownerDocument = ownerDocument;
    this.childNodes = []; this.parentNode = null; this._listeners = [];
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null; }
  get previousSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) - 1] ?? null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  appendChild(child) { child.parentNode?.removeChild(child); child.parentNode = this; this.childNodes.push(child); return child; }
  insertBefore(child, ref) {
    if (!ref) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    child.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, child); return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child); if (i >= 0) this.childNodes.splice(i, 1); child.parentNode = null;
    // As in a browser: removing the focused element (or an ancestor) leaves focus on <body>.
    const doc = this.ownerDocument ?? this;
    if (doc.activeElement && doc.activeElement !== doc.body && child.contains(doc.activeElement)) doc.activeElement = doc.body;
    return child;
  }
  append(...nodes) { for (const n of nodes) this.appendChild(typeof n === "string" ? this.ownerDocument.createTextNode(n) : n); }
  remove() { this.parentNode?.removeChild(this); }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.nodeType === 9; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(value) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (value !== "" && value != null) this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }
  addEventListener(type, listener, options) {
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    this._listeners.push({ type, listener, capture });
  }
  removeEventListener(type, listener, options) {
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    this._listeners = this._listeners.filter((l) => !(l.type === type && l.listener === listener && l.capture === capture));
  }
  dispatchEvent(event) {
    const path = [];
    for (let n = this; n; n = n.parentNode) path.push(n);
    event.target = this;
    const run = (node, capture) => {
      event.currentTarget = node;
      for (const l of node._listeners.slice()) if (l.type === event.type && l.capture === capture) l.listener.call(node, event);
    };
    for (let i = path.length - 1; i >= 0 && !event._stopped; i--) run(path[i], true);
    for (let i = 0; i < path.length && !event._stopped && (i === 0 || event.bubbles); i++) run(path[i], false);
    return !event.defaultPrevented;
  }
}

class Text extends Node {
  constructor(data, doc) { super(3, "#text", doc); this.data = data; }
  get nodeValue() { return this.data; }
  set nodeValue(v) { this.data = String(v); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class Comment extends Node {
  constructor(data, doc) { super(8, "#comment", doc); this.data = data; }
  get textContent() { return ""; }
}

class Element extends Node {
  constructor(tag, doc, namespaceURI = "http://www.w3.org/1999/xhtml") {
    const upper = namespaceURI === "http://www.w3.org/1999/xhtml" ? tag.toUpperCase() : tag;
    super(1, upper, doc);
    this.tagName = upper; this.localName = tag; this.namespaceURI = namespaceURI;
    this._attrs = new Map();
    this.dataset = {}; this.value = ""; this.defaultValue = ""; this.selectionStart = 0; this.selectionEnd = 0;
    this.offsetTop = 0; this.offsetLeft = 0; this.scrollTop = 0; this.scrollLeft = 0; this.scrollHeight = 0; this.clientHeight = 0; this.clientWidth = 0; this.offsetHeight = 0; this.offsetWidth = 0;
    const styles = {};
    this.style = new Proxy(styles, { get: (t, k) => (k === "setProperty" ? (n, v) => { t[n] = v; } : k === "removeProperty" ? (n) => { delete t[n]; } : t[k] ?? "") });
  }
  setAttribute(name, value) { this._attrs.set(name, String(value)); }
  setAttributeNS(_ns, name, value) { this._attrs.set(name, String(value)); }
  getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; }
  hasAttribute(name) { return this._attrs.has(name); }
  removeAttribute(name) { this._attrs.delete(name); }
  removeAttributeNS(_ns, name) { this._attrs.delete(name); }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get classList() {
    const get = () => (this.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    const set = (list) => this.setAttribute("class", list.join(" "));
    return {
      contains: (c) => get().includes(c),
      add: (...cs) => set([...new Set([...get(), ...cs])]),
      remove: (...cs) => set(get().filter((x) => !cs.includes(x))),
      toggle: (c, force) => { const on = force ?? !get().includes(c); if (on) set([...new Set([...get(), c])]); else set(get().filter((x) => x !== c)); return on; },
    };
  }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(selector)) return n; return null; }
  querySelectorAll(selector) { return this.findAll((e) => e.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
  getClientRects() { return []; }
  scrollTo() {} scrollBy() {} scrollIntoView() {} select() {}
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  focus() { this.ownerDocument.activeElement = this; }
  // <dialog>: open state only (no top layer, no native focus moves). close() fires "close" as a browser task would.
  showModal() { this.open = true; this.setAttribute("open", ""); }
  close() { if (!this.open) return; this.open = false; this.removeAttribute("open"); setTimeout(() => this.dispatchEvent({ type: "close", bubbles: false, preventDefault() {}, stopPropagation() {} }), 0); }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  /** Depth-first list of descendant elements matching `test`. */
  findAll(test) {
    const out = [];
    const walk = (n) => { for (const c of n.childNodes) if (c.nodeType === 1) { if (test(c)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}

class Document extends Node {
  constructor() {
    super(9, "#document", null);
    this.ownerDocument = null;
    this.documentElement = new Element("html", this);
    this.body = new Element("body", this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
    this.visibilityState = "visible"; this.hidden = false;
    // react-dom probes `"oninput" in document` once at load; without it, it falls back to an IE
    // polyfill (attachEvent) that cannot run here. Typing then works by setting `value` and
    // dispatching a bubbling "input" event.
    this.oninput = null;
  }
  hasFocus() { return true; }
  querySelectorAll(selector) { return this.documentElement.findAll((e) => e.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  getElementById(id) { return this.documentElement.findAll((e) => e.getAttribute("id") === id)[0] ?? null; }
  createElement(tag) { return new Element(tag, this); }
  createElementNS(ns, tag) { return new Element(tag, this, ns); }
  createTextNode(data) { return new Text(data, this); }
  createComment(data) { return new Comment(data, this); }
}

const document = new Document();
class HTMLIFrameElement {}
// Its presence makes react-dom use native composition events (onCompositionStart/End), as in a browser.
class CompositionEvent {}
class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
const winTarget = new Node(0, "#window", document);
const win = globalThis.window ?? {};
Object.assign(win, {
  document, HTMLIFrameElement, CompositionEvent, Node, Element, Text,
  addEventListener: winTarget.addEventListener.bind(winTarget), removeEventListener: winTarget.removeEventListener.bind(winTarget),
  dispatchEvent: winTarget.dispatchEvent.bind(winTarget),
  matchMedia: (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id) => clearTimeout(id),
  getComputedStyle: () => new Proxy({}, { get: (_t, k) => (k === "getPropertyValue" ? () => "" : "") }),
  ResizeObserver: Observer, MutationObserver: Observer, IntersectionObserver: Observer,
  innerWidth: 1024, innerHeight: 768, scrollTo() {},
});
for (const k of ["requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver", "MutationObserver", "IntersectionObserver", "matchMedia", "getComputedStyle"]) globalThis[k] ??= win[k];
globalThis.window = win;
globalThis.document = document;
globalThis.HTMLIFrameElement = HTMLIFrameElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Click `el` the way a browser would: a bubbling, cancelable click event. */
export function click(el) {
  const event = {
    type: "click", bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), button: 0, detail: 1,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stopped = true; },
  };
  return el.dispatchEvent(event);
}

export function mountPoint() { const el = document.createElement("div"); document.body.appendChild(el); return el; }
export { document };
