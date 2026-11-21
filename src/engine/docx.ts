import { Inflate } from 'fflate';

export const MAX_DOCX_BYTES = 2 * 1024 * 1024;
export const MAX_DOCX_XML_BYTES = 4 * 1024 * 1024;
export const MAX_DOCX_ENTRIES = 2048;
const WORD_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
const INVALID = 'DOCX 文件已损坏或格式不受支持，请用 Word 重新另存为 .docx 文件。';
const XML_LIMIT = 'DOCX 正文 XML 解压后超过 4 MB，请删去附件或分段导入。';

function invalid(): never { throw new Error(INVALID); }
function check(condition: boolean): asserts condition { if (!condition) invalid(); }

interface Entry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  start: number;
}

/** Validate the entire ZIP index and local framing, but never inflate unrelated parts. */
function documentEntry(data: Uint8Array): Entry {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fits = (at: number, size: number, end = data.length) => at >= 0 && at + size <= end;
  const u16 = (at: number) => { check(fits(at, 2)); return view.getUint16(at, true); };
  const u32 = (at: number) => { check(fits(at, 4)); return view.getUint32(at, true); };
  let end = data.length - 22;
  const earliest = Math.max(0, end - 65535);
  while (end >= earliest && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== data.length)) end--;
  check(end >= earliest);
  check(u16(end + 4) === 0 && u16(end + 6) === 0); // No split archives / ZIP64.
  const count = u16(end + 10);
  if (count > MAX_DOCX_ENTRIES) throw new Error('DOCX ZIP 条目超过 2048 个，请简化文件后重试。');
  const directory = u32(end + 16);
  check(count > 0 && count === u16(end + 8));
  check(directory + u32(end + 12) === end);

  const extra = (at: number, length: number) => {
    const stop = at + length;
    while (at < stop) {
      check(fits(at, 4, stop));
      const id = u16(at);
      // Reject ZIP64, encryption and alternate Unicode paths rather than interpreting aliases.
      check(![0x0001, 0x0017, 0x7075, 0x9901].includes(id));
      at += 4 + u16(at + 2);
      check(at <= stop);
    }
  };
  const path = (at: number, length: number, flags: number): string => {
    const bytes = data.subarray(at, at + length);
    if (!(flags & 0x0800)) check(bytes.every(byte => byte < 128)); // Legacy non-ASCII names are unsupported.
    let name: string;
    try { name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { return invalid(); }
    check(name.length > 0 && !/[\\:%?#\u0000-\u001f\u007f-\u009f\uFEFF]/.test(name));
    const parts = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
    check(parts.every(part => part !== '' && part === part.trim() && !part.endsWith('.')));
    return name;
  };

  const entries: Entry[] = [];
  const names = new Set<string>();
  let cursor = directory;
  for (let index = 0; index < count; index++) {
    check(fits(cursor, 46, end) && u32(cursor) === 0x02014b50);
    const flags = u16(cursor + 8);
    if (flags & (1 | 0x40 | 0x2000)) throw new Error('不支持加密的 DOCX 文件，请先移除密码。');
    const method = u16(cursor + 10);
    check((flags & ~0x080e) === 0 && (method === 0 || method === 8));
    check(method === 8 || (flags & 6) === 0);
    check(u16(cursor + 6) <= 20 && u16(cursor + 34) === 0);
    const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    check(next <= end);
    const name = path(cursor + 46, nameLength, flags);
    const key = name.normalize('NFC').toLowerCase().replace(/\/$/, '');
    if (names.has(key)) throw new Error('DOCX 含有重复 ZIP 条目或重复正文，请重新另存为 .docx 文件。');
    names.add(key);
    extra(cursor + 46 + nameLength, extraLength);
    const mode = (u32(cursor + 38) >>> 16) & 0xf000;
    check(mode === 0 || mode === 0x8000 || mode === 0x4000); // No symlinks / devices.
    const entry: Entry = {
      name, flags, method, crc: u32(cursor + 16), compressed: u32(cursor + 20),
      size: u32(cursor + 24), offset: u32(cursor + 42), start: 0,
    };
    check(entry.size !== 0xffffffff && entry.compressed !== 0xffffffff);
    if (method === 0) check(entry.size === entry.compressed);
    if (name.endsWith('/')) check(entry.size === 0);
    entries.push(entry);
    cursor = next;
  }
  check(cursor === end);

  // Contiguous, non-overlapping local records also rule out hidden/orphan entries and prefixes.
  entries.sort((a, b) => a.offset - b.offset);
  cursor = 0;
  for (const [index, entry] of entries.entries()) {
    const at = entry.offset;
    check(at === cursor && fits(at, 30, directory) && u32(at) === 0x04034b50);
    check(u16(at + 4) <= 20 && u16(at + 6) === entry.flags && u16(at + 8) === entry.method);
    const nameLength = u16(at + 26), extraLength = u16(at + 28);
    entry.start = at + 30 + nameLength + extraLength;
    check(entry.start <= directory && path(at + 30, nameLength, entry.flags) === entry.name);
    extra(at + 30 + nameLength, extraLength);
    const descriptor = !!(entry.flags & 8);
    for (const [position, expected] of [[14, entry.crc], [18, entry.compressed], [22, entry.size]]) {
      const actual = u32(at + position);
      check(actual === expected || (descriptor && actual === 0));
    }
    cursor = entry.start + entry.compressed;
    check(cursor <= directory);
    if (descriptor) {
      // A descriptor may omit its signature. Use the next record boundary to disambiguate CRC=signature.
      const next = entries[index + 1]?.offset ?? directory;
      const length = next - cursor;
      check(length === 12 || length === 16);
      if (length === 16) { check(u32(cursor) === 0x08074b50); cursor += 4; }
      check(u32(cursor) === entry.crc && u32(cursor + 4) === entry.compressed && u32(cursor + 8) === entry.size);
      cursor += 12;
    }
  }
  check(cursor === directory);
  const document = entries.find(entry => entry.name === 'word/document.xml');
  check(!!document);
  return document;
}

interface Huffman { table: Uint16Array; mask: number }
function huffman(lengths: number[], single = true): Huffman {
  const counts = new Uint16Array(16);
  for (const length of lengths) { check(length >= 0 && length <= 15); if (length) counts[length]++; }
  const max = Math.max(...lengths);
  let remaining = 1;
  for (let bits = 1; bits <= 15; bits++) { remaining = remaining * 2 - counts[bits]; check(remaining >= 0); }
  // An empty distance alphabet is legal if no matches are used; its table rejects any lookup.
  check(max === 0 || remaining === 0 || (single && max === 1 && counts[1] === 1));
  const table = new Uint16Array(1 << max);
  const next = new Uint16Array(16);
  let code = 0;
  for (let bits = 1; bits <= max; bits++) { code = (code + counts[bits - 1]) * 2; next[bits] = code; }
  lengths.forEach((length, symbol) => {
    if (!length) return;
    let value = next[length]++, reversed = 0;
    for (let bit = 0; bit < length; bit++) { reversed = (reversed << 1) | (value & 1); value >>>= 1; }
    for (let slot = reversed; slot < table.length; slot += 1 << length) table[slot] = (symbol << 4) | length;
  });
  return { table, mask: table.length - 1 };
}
const FIXED_LITERAL = huffman(Array.from({ length: 288 }, (_, n) => n < 144 ? 8 : n < 256 ? 9 : n < 280 ? 7 : 8));
const FIXED_DISTANCE = huffman(Array(32).fill(5));
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_BITS = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/** fflate's public streaming API does not prove BFINAL/consumed length (or check stored NLEN).
 * Preflight RFC1951 framing without allocating output, including distances and actual output size.
 */
function validateDeflate(data: Uint8Array): number {
  let position = 0, output = 0;
  const peek = () => (data[position >>> 3] | (data[(position >>> 3) + 1] << 8) | (data[(position >>> 3) + 2] << 16)) >>> (position & 7);
  const read = (bits: number) => {
    check(position + bits <= data.length * 8);
    const result = peek() & ((1 << bits) - 1);
    position += bits;
    return result;
  };
  const symbol = (tree: Huffman) => {
    const value = tree.table[peek() & tree.mask];
    check((value & 15) !== 0);
    read(value & 15);
    return value >>> 4;
  };
  const add = (size: number) => {
    output += size;
    if (output > MAX_DOCX_XML_BYTES) throw new Error(XML_LIMIT);
  };
  let final: number;
  do {
    final = read(1);
    const type = read(2);
    if (type === 0) {
      position = Math.ceil(position / 8) * 8;
      const length = read(16);
      check((length ^ read(16)) === 0xffff);
      position += length * 8;
      check(position <= data.length * 8);
      add(length);
      continue;
    }
    check(type !== 3);
    let literals = FIXED_LITERAL, distances = FIXED_DISTANCE;
    if (type === 2) {
      const literalCount = read(5) + 257, distanceCount = read(5) + 1, codeCount = read(4) + 4;
      check(literalCount <= 286);
      // RFC1951 code-length alphabet order (kept separate from literal/distance alphabets).
      const codeOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const codeLengths = Array(19).fill(0);
      for (let n = 0; n < codeCount; n++) codeLengths[codeOrder[n]] = read(3);
      const codes = huffman(codeLengths, false);
      const lengths: number[] = [];
      while (lengths.length < literalCount + distanceCount) {
        const value = symbol(codes);
        if (value < 16) lengths.push(value);
        else {
          check(value !== 16 || lengths.length > 0);
          const repeat = value === 16 ? read(2) + 3 : value === 17 ? read(3) + 3 : read(7) + 11;
          check(lengths.length + repeat <= literalCount + distanceCount);
          const length = value === 16 ? lengths[lengths.length - 1] : 0;
          for (let n = 0; n < repeat; n++) lengths.push(length);
        }
      }
      check(lengths[256] > 0);
      literals = huffman(lengths.slice(0, literalCount));
      distances = huffman(lengths.slice(literalCount));
    }
    for (;;) {
      const value = symbol(literals);
      if (value === 256) break;
      if (value < 256) { add(1); continue; }
      check(value <= 285);
      const length = LENGTH_BASE[value - 257] + read(LENGTH_BITS[value - 257]);
      const distanceCode = symbol(distances);
      check(distanceCode < 30);
      const distance = DISTANCE_BASE[distanceCode] + read(DISTANCE_BITS[distanceCode]);
      check(distance <= output);
      add(length);
    }
  } while (!final);
  check(Math.ceil(position / 8) === data.length);
  return output;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function inflateDocument(data: Uint8Array, entry: Entry): Uint8Array {
  if (entry.size > MAX_DOCX_XML_BYTES) throw new Error(XML_LIMIT);
  const compressed = data.subarray(entry.start, entry.start + entry.compressed);
  if (entry.method === 8) check(validateDeflate(compressed) === entry.size);
  // Allocate from neither originalSize nor compressed expansion guesses.
  const chunks: Uint8Array[] = [];
  let size = 0, crc = 0xffffffff;
  const accept = (chunk: Uint8Array) => {
    size += chunk.length;
    if (size > MAX_DOCX_XML_BYTES) throw new Error(XML_LIMIT);
    for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
    if (chunk.length) chunks.push(chunk);
  };
  if (entry.method === 0) accept(compressed);
  else {
    const inflater = new Inflate(accept);
    // A valid DEFLATE match expands at most 258 bytes for >=2 compressed bits.
    // 256-byte pushes bound each callback's allocation, including a buffered stored block (<=64 KiB).
    try {
      for (let at = 0; at < compressed.length; at += 256) {
        inflater.push(compressed.subarray(at, at + 256), at + 256 >= compressed.length);
      }
    } catch (error) {
      if (error instanceof Error && error.message === XML_LIMIT) throw error;
      invalid();
    }
  }
  check(size === entry.size && ((crc ^ 0xffffffff) >>> 0) === entry.crc);
  const xml = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { xml.set(chunk, at); at += chunk.length; }
  return xml;
}

function decodeXml(bytes: Uint8Array): string {
  let encoding = 'utf-8';
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)) encoding = 'utf-16le';
  else if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)) encoding = 'utf-16be';
  let xml: string;
  try { xml = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { return invalid(); }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('DOCX 正文含有不允许的 DOCTYPE 或 ENTITY 声明。');
  const declared = /^<\?xml\s[^?]*\bencoding\s*=\s*['"]([^'"]+)['"]/i.exec(xml)?.[1].toLowerCase();
  check(!declared || declared === encoding || (declared === 'utf-16' && encoding.startsWith('utf-16')));
  return xml;
}

const CONTAINERS = new Set(['body', 'p', 'r', 'tbl', 'tr', 'tc', 'hyperlink', 'ins', 'moveTo', 'sdt', 'sdtContent', 'customXml', 'smartTag', 'dir', 'bdo', 'fldSimple']);
function bodyText(xml: string, maxTextLength: number): string {
  let document: Document;
  try { document = new DOMParser().parseFromString(xml, 'application/xml'); }
  catch { return invalid(); }
  check(document.getElementsByTagNameNS('*', 'parsererror').length === 0 && !document.doctype);
  const root = document.documentElement;
  const namespace = root.namespaceURI;
  check(root.localName === 'document' && !!namespace && WORD_NAMESPACES.has(namespace));
  const bodies = Array.from(root.children).filter(child => child.localName === 'body' && child.namespaceURI === namespace);
  check(bodies.length === 1);
  const bounded = (text: string) => {
    if (text.length > maxTextLength) throw new Error('文字超过 50,000 字符，请分段审阅。');
    return text;
  };
  const render = (element: Element, paragraph: boolean, depth: number): string => {
    if (depth > 256) throw new Error('DOCX 正文结构嵌套过深，请简化文件后重试。');
    if (element.namespaceURI !== namespace) return '';
    const name = element.localName;
    if (name === 't') {
      check(element.children.length === 0);
      return paragraph ? bounded(element.textContent ?? '') : '';
    }
    if (name === 'tab') return paragraph ? '\t' : '';
    if (name === 'br' || name === 'cr') return paragraph ? '\n' : '';
    // Allowlist excludes deletions/moveFrom, instructions, drawings/textboxes and non-body parts.
    // Hyperlink/field *display text* is retained; relationship URLs and field instructions are never resolved.
    if (!CONTAINERS.has(name)) return '';
    // Word marks deleted rows/cells in their properties, not necessarily in a w:del wrapper.
    if (name === 'tr' || name === 'tc') {
      const property = Array.from(element.children).find(child => child.namespaceURI === namespace && child.localName === `${name}Pr`);
      if (property && Array.from(property.children).some(child => child.namespaceURI === namespace && child.localName === (name === 'tr' ? 'del' : 'cellDel'))) return '';
    }
    const inline = name === 'p' || (paragraph && !['tbl', 'tr', 'tc'].includes(name));
    const separator = name === 'tr' ? '\t' : inline ? '' : '\n';
    let result = '', pieces = 0;
    for (const child of Array.from(element.children)) {
      const text = render(child, inline, depth + 1);
      if (text === '' && !(name === 'tr' && child.localName === 'tc' && child.namespaceURI === namespace)) continue;
      result = bounded(result + (pieces++ ? separator : '') + text);
    }
    return result;
  };
  const text = render(bodies[0], false, 0);
  if (!text.trim()) throw new Error('DOCX 文件正文为空，请选择包含合同正文的文件。');
  return text;
}

/** Pure, synchronous, offline extraction. No relationships, network, logging or persistence.
 * Supports ordinary single-disk ZIP (stored/DEFLATE), UTF-8/UTF-16 XML, Transitional/Strict Word.
 * CRC is checked for document.xml only; other payloads are deliberately not decompressed.
 */
export function extractDocxText(data: Uint8Array, maxTextLength: number): string {
  if (data.length > MAX_DOCX_BYTES) throw new Error('DOCX 文件超过 2 MB，请删去附件或分段导入。');
  if (data.length === 0) throw new Error('DOCX 文件为空，请选择包含合同正文的文件。');
  return bodyText(decodeXml(inflateDocument(data, documentEntry(data))), maxTextLength);
}
