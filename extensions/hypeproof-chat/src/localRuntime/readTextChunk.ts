import * as fs from "node:fs/promises";

// Leave room for the prompt and earlier tool results. This is a per-read bound,
// not a guarantee about the aggregate provider request budget.
const CHUNK_BYTES = 48 * 1024;

export async function readTextChunk(file: string, offset: unknown = 0): Promise<string> {
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)
    throw Error("offset_bytes는 0 이상의 정수여야 합니다.");
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw Error("일반 텍스트 파일만 읽을 수 있습니다.");
    if (offset > stat.size) throw Error("offset_bytes가 파일 크기를 넘었습니다. 처음부터 다시 읽으세요.");
    // Check the file header even for subsequent chunks: binary containers must
    // not sneak through by seeking past their signature.
    const header = Buffer.alloc(8);
    await handle.read(header, 0, header.length, 0);
    if (header.subarray(0, 5).toString() === "%PDF-" ||
        (header[0] === 0x50 && header[1] === 0x4b))
      throw Error("바이너리 문서는 텍스트 추출 후 읽어야 합니다. 이 도구는 UTF-8 텍스트만 지원합니다.");
    const buffer = Buffer.alloc(CHUNK_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) throw Error("바이너리 파일은 텍스트로 읽을 수 없습니다.");
    let text: string;
    try {
      // Retain a partial trailing UTF-8 code point for the next read. A caller
      // starting inside a code point is rejected rather than silently corrupted.
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes, {
        stream: offset + bytesRead < stat.size,
      });
    } catch {
      throw Error("유효한 UTF-8 텍스트가 아닙니다. 파일 형식과 offset_bytes 경계를 확인하세요.");
    }
    // Tool results are JSON strings on the wire. A raw-byte bound alone lets
    // control characters expand up to sixfold and overflow the request budget.
    // Iterate code points only on that exceptional path; never split a surrogate.
    if (Buffer.byteLength(JSON.stringify(text), "utf8") > CHUNK_BYTES) {
      let wireBytes = 2; // JSON string quotes
      let end = 0;
      for (const character of text) {
        const cost = Buffer.byteLength(JSON.stringify(character), "utf8") - 2;
        if (wireBytes + cost > CHUNK_BYTES) break;
        wireBytes += cost;
        end += character.length;
      }
      text = text.slice(0, end);
    }
    const next = offset + Buffer.byteLength(text, "utf8");
    if (offset === 0 && next === stat.size) return text;
    const continuation = next < stat.size
      ? `Read를 같은 file_path와 offset_bytes=${next}로 호출하면 이어서 읽습니다.`
      : "파일 끝입니다.";
    return `[Studio file chunk: bytes ${offset}-${next} of ${stat.size}; UTF-8]\n${continuation}\n\n${text}`;
  } finally {
    await handle.close();
  }
}
