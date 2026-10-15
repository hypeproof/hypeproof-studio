// Photos attached to the chat as files (REQ-STUDIO-CHAT-PHOTO-FILES, hype-dental D-028).
// The pure parts of src/attachedImages.ts on a real temp folder: names, never overwriting,
// refusals, the message note, and the staging lifecycle (remove, send, dispose, leftovers of
// a crashed window, a live window's folder left alone).
//
// Run: node --experimental-strip-types test/attached-images.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const {
  ATTACHED_IMAGE_MAX_BYTES,
  ATTACHED_IMAGE_MAX_COUNT,
  attachedImageExt,
  safeAttachedImageName,
  freeAttachedImageName,
  attachedImagesNote,
  attachedImageRefusal,
  stagingRootFor,
  ImageStaging,
} = await import("../src/attachedImages.ts");

const ok = (name) => console.log(`✓ ${name}`);

// ── names ────────────────────────────────────────────────────────────────────
assert.equal(attachedImageExt("외관.JPG", ""), "jpg");
assert.equal(attachedImageExt("clip", "image/png"), "png", "no extension: the mime decides");
assert.equal(attachedImageExt("IMG_0001.heic", ""), "heic", "HEIC by name");
assert.equal(attachedImageExt("notes.pdf", "application/pdf"), null);
const nfd = "외관".normalize("NFD") + ".jpg";
assert.equal(safeAttachedImageName(nfd, "jpg"), "외관.jpg", "macOS NFD names are recomposed");
assert.equal(safeAttachedImageName("../../etc/a:b?.png", "png"), "a b.png", "no path parts or reserved characters");
assert.equal(safeAttachedImageName(".png", "png"), "사진.png", "an empty stem gets a name");
const taken = new Set(["외관.jpg", "외관-2.jpg"]);
assert.equal(freeAttachedImageName("외관.jpg", (n) => taken.has(n)), "외관-3.jpg");
assert.equal(freeAttachedImageName("내부.png", (n) => taken.has(n)), "내부.png");
assert.equal(attachedImagesNote(["images/외관.jpg", "images/내부.png"]), "[첨부한 사진]\n- images/외관.jpg\n- images/내부.png");
assert.equal(attachedImagesNote([]), "");
ok("names: extension, NFC, safe characters, never overwrite, the [첨부한 사진] note");

// ── refusals ─────────────────────────────────────────────────────────────────
const take = (o) => attachedImageRefusal({ name: "a.jpg", mime: "image/jpeg", bytes: 1000, alreadyStaged: 0, ...o });
assert.equal(take({}), null);
assert.match(take({ alreadyStaged: ATTACHED_IMAGE_MAX_COUNT }), /10장까지/);
assert.match(take({ name: "a.pdf", mime: "application/pdf" }), /사진 파일/);
assert.match(take({ bytes: ATTACHED_IMAGE_MAX_BYTES + 1 }), /25MB/);
assert.match(take({ bytes: 0 }), /빈 파일/);
ok("refusals: 10 photos, photo types only, 25 MB, empty file");

// ── staging lifecycle ────────────────────────────────────────────────────────
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-attached-")));
try {
  const { rootParent, root } = stagingRootFor(tmp, process.pid, "abc123");
  const ws = path.join(tmp, "ws");
  fs.mkdirSync(path.join(ws, "images"), { recursive: true });
  fs.writeFileSync(path.join(ws, "images", "외관.jpg"), "existing");
  // Leftovers: a dead window's folder goes, a live window's folder stays.
  const dead = path.join(rootParent, "999999999-old");
  const live = path.join(rootParent, "424242-live");
  fs.mkdirSync(dead, { recursive: true });
  fs.mkdirSync(live, { recursive: true });
  const staging = new ImageStaging(rootParent, root);
  staging.purgeLeftovers((pid) => pid === 424242);
  assert.equal(fs.existsSync(dead), false, "a crashed window's staging folder is removed");
  assert.equal(fs.existsSync(live), true, "a live window's staging folder is left alone");

  const photo = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);
  staging.stage("p1", "외관.jpg", photo);
  staging.stage("p2", "내부.png", Buffer.from([0x89, 0x50]));
  assert.equal(staging.count(), 2);
  staging.discard("p2");
  assert.equal(fs.existsSync(path.join(root, "p2")), false, "× deletes the staged file at once");
  assert.throws(() => staging.stage("../x", "x.jpg", photo), /bad stage id/);

  const saved = staging.commit(["p1", "missing"], ws);
  assert.deepEqual(saved, { relPaths: ["images/외관-2.jpg"], failed: 1 }, "saved under its own name, next free one");
  assert.deepEqual(fs.readFileSync(path.join(ws, "images", "외관-2.jpg")), photo, "bytes unchanged");
  assert.equal(fs.readFileSync(path.join(ws, "images", "외관.jpg"), "utf8"), "existing", "the existing file is not overwritten");
  assert.equal(fs.existsSync(path.join(root, "p1")), false, "staging emptied on send");

  staging.stage("p3", "x.jpg", photo);
  staging.dispose();
  assert.equal(fs.existsSync(root), false, "never sent → deleted with the window");
  ok("staging: leftovers by owner pid, ×, send into images/, dispose");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("\n✓ attached-images smoke 통과");
