import { deflateSync } from 'node:zlib';
function crc(bytes){let v=0xffffffff;for(const byte of bytes){v^=byte;for(let i=0;i<8;i++)v=(v>>>1)^((v&1)?0xedb88320:0);}return(v^0xffffffff)>>>0;}
function chunk(name,bytes){const head=Buffer.alloc(8);head.writeUInt32BE(bytes.length);head.write(name,4);const checksum=Buffer.alloc(4);checksum.writeUInt32BE(crc(Buffer.concat([Buffer.from(name),bytes])));return Buffer.concat([head,bytes,checksum]);}
export function png(width=8,height=8,pixel=(x,y)=>[230,180,80,x>1&&x<width-2&&y>1&&y<height-2?255:0]){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const raw=Buffer.alloc((1+width*4)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)raw.set(pixel(x,y),y*(1+width*4)+1+x*4);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
