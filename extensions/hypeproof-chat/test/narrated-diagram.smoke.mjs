// CGP-LEARN-R-009 / D-009 — the built-in diagram library, pure: every drawing fits the 640x400 artboard and leaves the
// reserved 120x120 control area empty; exactly three beats (시작 / 변화 / 결과), each emphasising parts that exist, its marker
// on the board; colour roles only from the role list; the node labels are a separate text table whose every label fits a
// 168 px text layer at 14 px (the Service's width estimate); the SVG's accessible name carries every letter and its label.
// Node only.
import assert from 'node:assert/strict';
import * as D from '../src/narratedDiagram.ts';
import * as B from '../src/blockParams.ts';

let n = 0;
const ok = (label) => { n++; console.log(`  ok   ${label}`); };

assert.deepEqual([...D.DIAGRAM_IDS].sort(), [...B.BLOCK_SPECS.narrated_diagram['1'].params.diagram.values].sort(), 'the library draws exactly the v1 enum');
ok('the library is the v1 diagram enum');

for (const id of D.DIAGRAM_IDS) {
  assert.deepEqual(D.geometryProblems(id), [], id);
  const d = D.DIAGRAMS[id], t = D.DIAGRAM_TEXT[id];
  assert.equal(d.beats.length, 3, `${id}: three beats`);
  for (const b of d.beats) assert.ok(b.emphasis.length > 0, `${id}: every beat emphasises something`);
  assert.deepEqual(Object.keys(t.nodes).sort(), d.nodes.map((x) => x.id).sort(), `${id}: one label per node, no other`);
  for (const [node, label] of Object.entries(t.nodes)) {
    assert.ok(B.safeLine(label, true), `${id}.${node}: a safe single line`);
    assert.ok(B.textLayerWidthPx(label, 14) <= 168, `${id}.${node}: "${label}" fits 168 px at 14 px`);
  }
  assert.ok(B.textLayerWidthPx(t.name, 14) <= 488, `${id}: the name fits a caption line`);
  const aria = D.diagramAriaLabel(id);
  assert.ok(aria.startsWith(t.name), aria);
  for (const node of d.nodes) assert.ok(aria.includes(`${node.letter} ${t.nodes[node.id]}`), `${id}: the accessible name maps ${node.letter}`);
  for (let beat = 0; beat < 3; beat++) {
    for (const node of d.nodes) assert.ok(D.COLOR_ROLES.includes(D.partRole(id, beat, node.id, 'node')));
    for (const a of d.arrows) assert.ok(D.COLOR_ROLES.includes(D.partRole(id, beat, a.id, 'arrow')));
  }
  assert.equal(D.partRole(id, 0, d.beats[0].emphasis[0], d.nodes.some((x) => x.id === d.beats[0].emphasis[0]) ? 'node' : 'arrow'), 'accent');
  ok(`${id}: on the board, control area clear, three beats, role names only, labels fit, aria maps every letter`);
}

assert.deepEqual([0, 1, 2].map(D.beatLabel), ['1 / 3 장면 · 시작', '2 / 3 장면 · 변화', '3 / 3 장면 · 결과']);
assert.deepEqual([D.beatMove(0, -1), D.beatMove(0, 1), D.beatMove(2, 1), D.beatMove(1, -1)], [0, 1, 2, 0]);
ok('beat labels and moves stay inside 1..3');

// Negative control: the geometry check itself catches a part in the control area and an unknown emphasis.
const saved = D.DIAGRAMS.page_request;
const broken = { ...saved, nodes: [...saved.nodes, { id: 'x', letter: 'Z', x: 560, y: 330, w: 40, h: 40 }], beats: [{ ...saved.beats[0], emphasis: ['nope'] }, saved.beats[1], saved.beats[2]] };
Object.defineProperty(D.DIAGRAMS, 'page_request', { value: broken, configurable: true, writable: true });
try {
  const problems = D.geometryProblems('page_request');
  assert.ok(problems.some((p) => p.includes('control area')) && problems.some((p) => p.includes('unknown nope')), problems.join('; '));
} finally { Object.defineProperty(D.DIAGRAMS, 'page_request', { value: saved, configurable: true, writable: true }); }
ok('negative control: a part in the control area and an unknown emphasis are reported');

console.log(`${n} narrated diagram checks passed`);
