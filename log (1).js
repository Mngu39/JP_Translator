const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c=n;
    for(let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n]=c>>>0;
  }
  return table;
})();

function crc32(bytes){
  let c=0xFFFFFFFF;
  for(const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function u16(n){
  const a=new Uint8Array(2);
  new DataView(a.buffer).setUint16(0,n,true);
  return a;
}

function u32(n){
  const a=new Uint8Array(4);
  new DataView(a.buffer).setUint32(0,n>>>0,true);
  return a;
}

function concat(parts){
  const total=parts.reduce((n,p)=>n+p.byteLength,0);
  const out=new Uint8Array(total);
  let offset=0;
  for(const p of parts){ out.set(p,offset); offset+=p.byteLength; }
  return out;
}

function dosDateTime(date=new Date()){
  const year=Math.max(1980,date.getFullYear());
  const time=((date.getHours() & 31)<<11)|((date.getMinutes() & 63)<<5)|((Math.floor(date.getSeconds()/2)) & 31);
  const day=((year-1980)<<9)|(((date.getMonth()+1)&15)<<5)|(date.getDate()&31);
  return {time,day};
}

async function toBytes(data){
  if(data instanceof Uint8Array) return data;
  if(data instanceof ArrayBuffer) return new Uint8Array(data);
  if(data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return encoder.encode(String(data ?? ""));
}

export async function createStoredZip(entries){
  const localParts=[];
  const centralParts=[];
  let offset=0;
  const {time,day}=dosDateTime();

  for(const entry of entries){
    const nameBytes=encoder.encode(String(entry.name).replace(/\\/g,"/"));
    const data=await toBytes(entry.data);
    const crc=crc32(data);
    const flags=0x0800; // UTF-8 filename

    const local=concat([
      u32(0x04034b50), u16(20), u16(flags), u16(0), u16(time), u16(day),
      u32(crc), u32(data.byteLength), u32(data.byteLength),
      u16(nameBytes.byteLength), u16(0), nameBytes, data
    ]);
    localParts.push(local);

    const central=concat([
      u32(0x02014b50), u16(20), u16(20), u16(flags), u16(0), u16(time), u16(day),
      u32(crc), u32(data.byteLength), u32(data.byteLength),
      u16(nameBytes.byteLength), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes
    ]);
    centralParts.push(central);
    offset += local.byteLength;
  }

  const centralBytes=concat(centralParts);
  const end=concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBytes.byteLength), u32(offset), u16(0)
  ]);
  return new Blob([...localParts, centralBytes, end], {type:"application/zip"});
}
