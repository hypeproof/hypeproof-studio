// Narrow, bounded PNG decoder for image-edit validation. Supports 8-bit RGB/RGBA,
// non-interlaced provider PNGs. Unsupported formats fail explicitly, never assume alpha.
export interface PngInfo { mime: 'image/png'; width: number; height: number; hasAlpha: boolean; transparentPixels: number; opaquePixels: number; partialAlphaPixels: number }
const MAGIC = [137,80,78,71,13,10,26,10];
function crc32(bytes: Uint8Array): number {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function paeth(a:number,b:number,c:number):number {const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
export async function inspectEditPng(bytes: Uint8Array,maxDimension=2048):Promise<PngInfo>{
  if(bytes.length<45||!MAGIC.every((v,i)=>bytes[i]===v))throw new Error('invalid_png');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let offset=8,width=0,height=0,channels=0,ended=false,seenIdat=false;const compressed:Uint8Array[]=[];
  while(offset+12<=bytes.length){
    const length=view.getUint32(offset),start=offset+8,end=start+length;
    if(end+4>bytes.length)throw new Error('invalid_png_chunk');
    const kind=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
    if(crc32(bytes.subarray(offset+4,end))!==view.getUint32(end))throw new Error('invalid_png_crc');
    if(offset===8&&kind!=='IHDR')throw new Error('invalid_png_header');
    if(kind==='IHDR'){
      if(width||length!==13)throw new Error('invalid_png_header');
      width=view.getUint32(start);height=view.getUint32(start+4);
      const depth=bytes[start+8],color=bytes[start+9];
      if(!width||!height||width>maxDimension||height>maxDimension)throw new Error('png_dimensions_exceeded');
      if(depth!==8||![2,6].includes(color??-1)||bytes[start+10]!==0||bytes[start+11]!==0||bytes[start+12]!==0)throw new Error('unsupported_png_encoding');
      channels=color===6?4:3;
    }else if(kind==='IDAT'){if(!width)throw new Error('invalid_png_header');seenIdat=true;compressed.push(bytes.subarray(start,end));}
    else if(kind==='IEND'){if(length!==0)throw new Error('invalid_png_end');ended=true;offset=end+4;break;}
    else if(kind==='tRNS'||kind==='acTL')throw new Error('unsupported_png_encoding');
    else if(kind[0]===kind[0]?.toUpperCase()&&kind!=='PLTE')throw new Error('unsupported_png_chunk');
    offset=end+4;
  }
  if(!ended||offset!==bytes.length||!seenIdat||!width)throw new Error('incomplete_png');
  const rowBytes=width*channels,expected=(rowBytes+1)*height;
  const encoded=new Uint8Array(compressed.reduce((n,b)=>n+b.length,0));let pos=0;for(const b of compressed){encoded.set(b,pos);pos+=b.length;}
  const reader=new Blob([encoded]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const raw=new Uint8Array(expected);let total=0;
  try{for(;;){const next=await reader.read();if(next.done)break;if(total+next.value.length>expected)throw new Error('png_decompression_limit');raw.set(next.value,total);total+=next.value.length;}}
  finally{await reader.cancel().catch(()=>{});}
  if(total!==expected)throw new Error('invalid_png_pixels');
  let previous=new Uint8Array(rowBytes),transparentPixels=0,opaquePixels=0,partialAlphaPixels=0;
  for(let y=0;y<height;y++){
    const base=y*(rowBytes+1),filter=raw[base];if(filter===undefined||filter>4)throw new Error('invalid_png_filter');
    const row=new Uint8Array(rowBytes);
    for(let x=0;x<rowBytes;x++){
      const a=x>=channels?row[x-channels]??0:0,b=previous[x]??0,c=x>=channels?previous[x-channels]??0:0;
      const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
      row[x]=((raw[base+1+x]??0)+predictor)&255;
    }
    for(let x=0;x<width;x++){const alpha=channels===4?row[x*4+3]??255:255;if(alpha===0)transparentPixels++;else if(alpha===255)opaquePixels++;else partialAlphaPixels++;}
    previous=row;
  }
  return {mime:'image/png',width,height,hasAlpha:channels===4,transparentPixels,opaquePixels,partialAlphaPixels};
}
export async function imageBytesHash(bytes:Uint8Array):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function decodeEditBase64(value:unknown,maxBytes=8*1024*1024):Uint8Array{
  if(typeof value!=='string'||!value||value.length>Math.ceil(maxBytes/3)*4||value.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error('invalid_image_data');
  const raw=atob(value);if(raw.length>maxBytes)throw new Error('image_too_large');return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
