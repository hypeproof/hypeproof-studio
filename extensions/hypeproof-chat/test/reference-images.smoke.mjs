import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { imagePathsFromNotes, selectReferencedImagePaths, readWorkspaceReferenceImages, referenceImageFailuresNote, referenceImageMime } from '../src/referenceImages.ts';
import { pastedImageNote } from '../src/pastedImages.ts';
import { attachedImagesNote } from '../src/attachedImages.ts';
import { sdkPromptWithImages, proxyUserContent, modelImageSources } from '../src/visionInput.ts';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6ioAAAAASUVORK5CYII=','base64');
const root=mkdtempSync(join(tmpdir(),'hps-reference-'));
const cwd=join(root,'workspace');mkdirSync(join(cwd,'assets'),{recursive:true});mkdirSync(join(cwd,'images'));
writeFileSync(join(cwd,'images','한글.jpg'),png); // Misleading extension: detect actual PNG bytes.
writeFileSync(join(root,'secret.png'),png);writeFileSync(join(cwd,'images','fake.png'),'not an image');
try {
 const note=attachedImagesNote(['images/한글.jpg']);
 const history=[{role:'user',content:`참고해줘\n\n${note}`},{role:'assistant',content:attachedImagesNote(['images/not-eligible.png'])}];
 assert.deepEqual(imagePathsFromNotes(note),['images/한글.jpg']);
 assert.deepEqual(imagePathsFromNotes(pastedImageNote(['assets/pasted.png'],cwd)),['assets/pasted.png']);
 assert.deepEqual(selectReferencedImagePaths('아까 사진의 키보드를 다시 봐줘',history),{requested:true,paths:['images/한글.jpg']});
 assert.deepEqual(selectReferencedImagePaths('한글.jpg를 다시 봐줘',history),{requested:true,paths:['images/한글.jpg']});
 assert.deepEqual(selectReferencedImagePaths('색을 파랗게',history),{requested:false,paths:[]});
 assert.deepEqual(selectReferencedImagePaths('이전 이미지와 비교해줘',[]),{requested:true,paths:[]});
 assert.match(referenceImageFailuresNote([],true),/이전 이미지 경로를 찾지 못/);
 const read=()=>readWorkspaceReferenceImages({cwd,paths:['images/한글.jpg'],allowed:true});
 const first=read();assert.equal(first.failures.length,0);assert.equal(first.assets[0].mime,'image/png');
 assert.equal(first.assets[0].sha256,createHash('sha256').update(png).digest('hex'));
 const turns=[];for await(const turn of sdkPromptWithImages('compare',first.images))turns.push(turn);
 assert.equal(turns[0].message.content[1].source.data,png.toString('base64'));
 assert.equal(proxyUserContent('compare',first.images)[1].image_url.url,first.images[0]);
 // Re-read, do not resurrect stale thumbnail bytes.
 const gif=Buffer.from('GIF89a-changed');writeFileSync(join(cwd,'images','한글.jpg'),gif);
 assert.notEqual(read().assets[0].sha256,first.assets[0].sha256);assert.equal(read().assets[0].mime,'image/gif');
 rmSync(join(cwd,'images','한글.jpg'));assert.equal(read().images.length,0);assert.match(read().failures[0].reason,/없어요/);
 symlinkSync(join(root,'secret.png'),join(cwd,'images','link.png'));
 symlinkSync(root,join(cwd,'linked'));
 const denied=readWorkspaceReferenceImages({cwd,paths:['../secret.png',join(root,'secret.png'),'images/link.png','linked/secret.png','images/fake.png'],allowed:true});
 assert.equal(denied.images.length,0);assert.equal(denied.failures.length,5);
 assert.equal(readWorkspaceReferenceImages({cwd,paths:['images/fake.png'],allowed:false}).images.length,0);
 assert.match(readWorkspaceReferenceImages({cwd,paths:['images/fake.png'],allowed:false}).failures[0].reason,/허용하지/);
 assert.equal(referenceImageMime(Buffer.from('<svg/>')),null);
 for(const input of [['file:///tmp/private.png'],['data:image/png;base64,%%%'],Array(5).fill(first.images[0])])assert.throws(()=>modelImageSources(input));
 assert.equal(sdkPromptWithImages('ordinary'), 'ordinary');assert.equal(proxyUserContent('ordinary'), 'ordinary');
 console.log('PASS reference images: explicit reread, MIME/hash/pixels, current-turn SDK/proxy blocks, changed/missing/denied/path/symlink negative controls');
}finally{rmSync(root,{recursive:true,force:true});}
