// @vitest-environment jsdom
import { deflateSync, Inflate, strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deflateRawSync, constants } from 'node:zlib';
import { extractDocxText, MAX_DOCX_BYTES, MAX_DOCX_ENTRIES, MAX_DOCX_XML_BYTES } from './docx';

const STANDARD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STRICT = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const document = (body: string, namespace = STANDARD) => `<w:document xmlns:w="${namespace}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`;
const zip = (xml = document(paragraph('合同正文')), level: 0 | 6 | 9 = 6, extra: Record<string, Uint8Array> = {}) =>
  zipSync({ 'word/document.xml': strToU8(xml), ...extra }, { level });
const extract = (data: Uint8Array) => extractDocxText(data, 50_000);
const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const u16 = (data: Uint8Array, at: number) => view(data).getUint16(at, true);
const u32 = (data: Uint8Array, at: number) => view(data).getUint32(at, true);
const set16 = (data: Uint8Array, at: number, value: number) => view(data).setUint16(at, value, true);
const set32 = (data: Uint8Array, at: number, value: number) => view(data).setUint32(at, value, true);
const central = (data: Uint8Array) => u32(data, data.length - 6);
const start = (data: Uint8Array) => 30 + u16(data, 26) + u16(data, 28);
const join = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) { result.set(part, at); at += part.length; }
  return result;
};
const patch = (fn: (data: Uint8Array, directory: number) => void, data = zip()) => {
  fn(data, central(data));
  return data;
};
// Build every fixture with zipSync; only the field/stream under test is then altered.
const rawDeflate = (raw: Uint8Array, text: string) => {
  const base = zip(text, 0);
  const at = start(base), oldDirectory = central(base);
  const result = join(base.subarray(0, at), raw, base.subarray(oldDirectory));
  const directory = at + raw.length;
  set32(result, result.length - 6, directory);
  set16(result, 8, 8); set16(result, directory + 10, 8);
  set32(result, 18, raw.length); set32(result, directory + 20, raw.length);
  return result;
};
const withDescriptor = (signature: boolean) => {
  const base = zip(), oldDirectory = central(base);
  const descriptor = new Uint8Array(signature ? 16 : 12);
  const at = signature ? 4 : 0;
  if (signature) set32(descriptor, 0, 0x08074b50);
  set32(descriptor, at, u32(base, 14));
  set32(descriptor, at + 4, u32(base, 18));
  set32(descriptor, at + 8, u32(base, 22));
  const result = join(base.subarray(0, oldDirectory), descriptor, base.subarray(oldDirectory));
  const directory = oldDirectory + descriptor.length;
  set32(result, result.length - 6, directory);
  set16(result, 6, u16(result, 6) | 8);
  set16(result, directory + 8, u16(result, directory + 8) | 8);
  for (const field of [14, 18, 22]) set32(result, field, 0);
  return result;
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('DOCX 正文提取', () => {
  it.each([STANDARD, STRICT])('读取命名空间 %s 的正文、表格、tab/br', namespace => {
    const body = '<w:p><w:r><w:t>甲方</w:t><w:tab/><w:t>乙方</w:t><w:br/><w:t>合同</w:t></w:r></w:p>' +
      `<w:tbl><w:tr><w:tc>${paragraph('项目')}</w:tc><w:tc>${paragraph('金额')}</w:tc></w:tr>` +
      `<w:tr><w:tc>${paragraph('租金')}</w:tc><w:tc>${paragraph('1000')}${paragraph('每月')}</w:tc></w:tr></w:tbl>` + paragraph('尾款');
    expect(extract(zip(document(body, namespace)))).toBe('甲方\t乙方\n合同\n项目\t金额\n租金\t1000\n每月\n尾款');
  });
  it('识别默认命名空间，不依赖 w 前缀', () => {
    expect(extract(zip(`<document xmlns="${STRICT}"><body><p><r><t>严格正文</t></r></p></body></document>`))).toBe('严格正文');
  });
  it('保留文字空白、尾部 tab/br、XML 转义；不执行 HTML', () => {
    const body = '<w:p><w:r><w:t xml:space="preserve"> &lt;img src=x onerror=alert(1)&gt;&amp; </w:t><w:tab/><w:cr/><w:br/></w:r></w:p>';
    expect(extract(zip(document(body)))).toBe(' <img src=x onerror=alert(1)>& \t\n\n');
  });
  it('只取正文，忽略删除修订、字段指令、图像、批注及页眉页脚；保留插入与字段显示值', () => {
    const body = '<w:p><w:r><w:t>正文</w:t></w:r>' +
      '<w:del><w:r><w:t>删除</w:t><w:delText>删除文本</w:delText></w:r></w:del>' +
      '<w:moveFrom><w:r><w:t>移出</w:t></w:r></w:moveFrom>' +
      '<w:ins><w:r><w:t>插入</w:t></w:r></w:ins><w:moveTo><w:r><w:t>移入</w:t></w:r></w:moveTo>' +
      '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>INCLUDETEXT https://invalid.test/private</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>显示值</w:t><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:drawing><w:t>图片</w:t></w:drawing><w:pict><w:txbxContent><w:p><w:r><w:t>文本框</w:t></w:r></w:p></w:txbxContent></w:pict></w:r>' +
      '<w:comment><w:r><w:t>批注</w:t></w:r></w:comment>' +
      '<w:hyperlink r:id="external"><w:r><w:t>链接文字</w:t></w:r></w:hyperlink></w:p>' +
      '<w:hdr>' + paragraph('伪页眉') + '</w:hdr><w:ftr>' + paragraph('伪页脚') + '</w:ftr>' +
      '<w:sdt><w:sdtPr><w:t>属性</w:t></w:sdtPr><w:sdtContent>' + paragraph('内容控件') + '</w:sdtContent></w:sdt>';
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const xml = document(body).replace('<w:body>', '<w:hdr>' + paragraph('根页眉') + '</w:hdr><w:body>');
    const archive = zip(xml, 6, {
      'word/header1.xml': strToU8(paragraph('页眉')),
      'word/footer1.xml': strToU8(paragraph('页脚')),
      'word/comments.xml': strToU8(paragraph('批注')),
      'word/_rels/document.xml.rels': strToU8('<Relationships><Relationship Id="external" Target="https://invalid.test/private" TargetMode="External"/></Relationships>'),
      'word/media/image.png': new Uint8Array(100),
    });
    expect(extract(archive)).toBe('正文插入移入显示值链接文字\n内容控件');
    expect(fetch).not.toHaveBeenCalled(); expect(xhr).not.toHaveBeenCalled();
  });
  it('删除行、删除单元格的属性标记不能泄露已删除文字', () => {
    const body = '<w:tbl><w:tr><w:trPr><w:del w:id="1"/></w:trPr><w:tc>' + paragraph('已删除行') + '</w:tc></w:tr>' +
      '<w:tr><w:tc><w:tcPr><w:cellDel w:id="2"/></w:tcPr>' + paragraph('已删除单元格') + '</w:tc><w:tc>' + paragraph('当前正文') + '</w:tc></w:tr></w:tbl>';
    expect(extract(zip(document(body)))).toBe('\t当前正文');
  });
  it('支持 UTF-8 部件名称、正常空格、目录与有界的普通额外字段', () => {
    const archive = zipSync({
      'word/document.xml': strToU8(document(paragraph('正文'))),
      'word/media/': new Uint8Array(),
      'word/media/合同 image.png': new Uint8Array([1, 2, 3]),
    }, { extra: { 0xcafe: new Uint8Array([1, 2, 3]) } });
    expect(extract(archive)).toBe('正文');
  });
  it.each([0, 6, 9] as const)('支持 ZIP 压缩级别 %s', level => {
    expect(extract(zip(undefined, level))).toBe('合同正文');
  });
  it.each([false, true])('支持经过中央目录校验的数据描述符，签名=%s', signature => {
    expect(extract(withDescriptor(signature))).toBe('合同正文');
  });
  it('支持 UTF-8 BOM、UTF-16LE/BE XML', () => {
    expect(extract(zip('\uFEFF' + document(paragraph('中文'))))).toBe('中文');
    for (const littleEndian of [true, false]) {
      const source = '\uFEFF<?xml version="1.0" encoding="UTF-16"?>' + document(paragraph('中文'));
      const bytes = new Uint8Array(source.length * 2);
      for (let n = 0; n < source.length; n++) view(bytes).setUint16(n * 2, source.charCodeAt(n), littleEndian);
      expect(extract(zipSync({ 'word/document.xml': bytes }))).toBe('中文');
    }
  });
  it('包含空表格单元格时保留列界线', () => {
    expect(extract(zip(document(`<w:tbl><w:tr><w:tc/> <w:tc>${paragraph('值')}</w:tc><w:tc/></w:tr></w:tbl>`)))).toBe('\t值\t');
  });
});

describe('DOCX 配额与空内容', () => {
  it.each(['', '<w:p/>', paragraph(' \t\n'), '<w:del>' + paragraph('删除内容') + '</w:del>'])('拒绝空白正文 %s', body => {
    expect(() => extract(zip(document(body)))).toThrow('正文为空');
  });
  it('拒绝零字节及缺失正文部件，不把损坏文件当成空文件', () => {
    expect(() => extract(new Uint8Array())).toThrow('文件为空');
    expect(() => extract(zipSync({ 'word/header1.xml': strToU8('页眉') }))).toThrow('损坏');
    expect(() => extract(zipSync({}))).toThrow('损坏');
    expect(() => extract(zip(''))).toThrow('损坏');
  });
  it('直接调用提取 API 仍检查 2 MB 文件限制', () => {
    expect(() => extract(new Uint8Array(MAX_DOCX_BYTES + 1))).toThrow('2 MB');
  });
  it('字符计数包括段落分隔符与 tab/br，精确接受 50,000', () => {
    const body = paragraph('x'.repeat(49_997)) + '<w:p><w:r><w:t>x</w:t><w:tab/></w:r></w:p>';
    expect(extract(zip(document(body))).length).toBe(50_000);
    expect(() => extract(zip(document(body + paragraph('x'))))).toThrow('50,000');
  });
  it('允许 XML 实际输出恰好 4 MB，拒绝多一个字节', () => {
    const base = document(paragraph('正文') + '<!---->');
    const padding = MAX_DOCX_XML_BYTES - strToU8(base).length;
    const atLimit = base.replace('<!---->', '<!--' + 'x'.repeat(padding) + '-->');
    expect(strToU8(atLimit).length).toBe(MAX_DOCX_XML_BYTES);
    expect(extract(zip(atLimit, 9))).toBe('正文');
    expect(() => extract(zip(atLimit.replace('<!--', '<!--x'), 9))).toThrow('4 MB');
  });
  it.each([0, 1, 1000])('zip bomb 伪造 originalSize=%s 仍以实际展开量限额，且不按尺寸分配', size => {
    const bomb = zip('x'.repeat(16 * 1024 * 1024), 9);
    patch((data, directory) => { set32(data, 22, size); set32(data, directory + 24, size); }, bomb);
    const push = vi.spyOn(Inflate.prototype, 'push');
    expect(() => extract(bomb)).toThrow('4 MB');
    expect(push).not.toHaveBeenCalled(); // Structural preflight aborts without materializing the bomb.
  });
  it('声明超限立即拒绝，声明少于实际输出拒绝而非截断', () => {
    expect(() => extract(patch((data, directory) => {
      set32(data, 22, MAX_DOCX_XML_BYTES + 1); set32(data, directory + 24, MAX_DOCX_XML_BYTES + 1);
    }))).toThrow('4 MB');
    expect(() => extract(patch((data, directory) => { set32(data, 22, 1); set32(data, directory + 24, 1); }))).toThrow('损坏');
  });
  it('实际 Inflate.push 使用不超过 256 字节的小压缩块', () => {
    const text = Array.from({ length: 5000 }, (_, i) => String.fromCharCode(0x4e00 + (i * 179) % 20000)).join('');
    const push = vi.spyOn(Inflate.prototype, 'push');
    expect(extract(zip(document(paragraph(text))))).toBe(text);
    expect(push.mock.calls.length).toBeGreaterThan(1);
    expect(push.mock.calls.every(([chunk]) => chunk.length <= 256)).toBe(true);
  });
  it('独立统计实际回调输出，超限立刻抛错，不能只依赖预检或 originalSize', () => {
    vi.spyOn(Inflate.prototype, 'push').mockImplementation(function (this: Inflate) {
      this.ondata(new Uint8Array(MAX_DOCX_XML_BYTES + 1), true);
    });
    expect(() => extract(zip())).toThrow('4 MB');
  });
  it('fflate 运行时错误不能吞成空内容或暴露英文错误', () => {
    vi.spyOn(Inflate.prototype, 'push').mockImplementation(() => { throw new Error('invalid distance'); });
    expect(() => extract(zip())).toThrow('损坏');
  });
  it('只解压正文；超高压缩比的无关图片不展开', () => {
    const push = vi.spyOn(Inflate.prototype, 'push');
    const archive = zip(undefined, 9, { 'word/media/image.bin': new Uint8Array(8 * 1024 * 1024) });
    expect(extract(archive)).toBe('合同正文');
    expect(push.mock.calls.reduce((size, [chunk]) => size + chunk.length, 0)).toBe(u32(archive, 18));
  });
  it('允许 2048 个 ZIP 条目，拒绝 2049（即使正文排在最前）', () => {
    const entries: Record<string, Uint8Array> = { 'word/document.xml': strToU8(document(paragraph('正文'))) };
    for (let n = 1; n < MAX_DOCX_ENTRIES; n++) entries[`word/media/${n}.bin`] = new Uint8Array();
    expect(extract(zipSync(entries, { level: 0 }))).toBe('正文');
    entries['word/media/overflow.bin'] = new Uint8Array();
    expect(() => extract(zipSync(entries, { level: 0 }))).toThrow('2048');
  });
});

describe('ZIP 完整性与路径', () => {
  it.each([1, 10, 21, 22, 30])('拒绝文件尾截断 %s 字节', removed => {
    const data = zip();
    expect(() => extract(data.subarray(0, -removed))).toThrow('损坏');
  });
  it.each([0, 6] as const)('验证正文 CRC，压缩级别 %s', level => {
    expect(() => extract(patch((data, directory) => {
      const badCRC = (u32(data, 14) ^ 1) >>> 0;
      set32(data, 14, badCRC); set32(data, directory + 16, badCRC);
    }, zip(undefined, level)))).toThrow('损坏');
  });
  it('拒绝存储正文中的字节损坏', () => {
    expect(() => extract(patch(data => { data[start(data) + 10] ^= 1; }, zip(undefined, 0)))).toThrow('损坏');
  });
  it.each([
    ['本地头 CRC', (data: Uint8Array) => set32(data, 14, 0)],
    ['本地压缩大小', (data: Uint8Array) => set32(data, 18, 1)],
    ['本地原始大小', (data: Uint8Array) => set32(data, 22, 1)],
    ['本地路径', (data: Uint8Array) => { data[30] = 120; }],
    ['本地签名', (data: Uint8Array) => { data[0] = 0; }],
    ['中央目录签名', (data: Uint8Array, directory: number) => { data[directory] = 0; }],
    ['中央目录长度', (data: Uint8Array) => set32(data, data.length - 10, 1)],
    ['中央目录位置', (data: Uint8Array) => set32(data, data.length - 6, 1)],
    ['中央目录条目计数', (data: Uint8Array) => set16(data, data.length - 12, 2)],
    ['本地记录重叠', (data: Uint8Array, directory: number) => set32(data, directory + 42, 1)],
    ['分卷', (data: Uint8Array) => set16(data, data.length - 18, 1)],
    ['符号链接', (data: Uint8Array, directory: number) => set32(data, directory + 38, 0xa0000000)],
    ['未知压缩法', (data: Uint8Array, directory: number) => { set16(data, 8, 99); set16(data, directory + 10, 99); }],
    ['ZIP64 哨兵', (data: Uint8Array, directory: number) => set32(data, directory + 24, 0xffffffff)],
  ] as const)('拒绝%s异常', (_, mutate) => {
    expect(() => extract(patch(mutate))).toThrow('损坏');
  });
  it('支持合法 ZIP 注释，但拒绝追加垃圾', () => {
    const base = zip(), comment = strToU8('本地注释');
    set16(base, base.length - 2, comment.length);
    expect(extract(join(base, comment))).toBe('合同正文');
    expect(() => extract(join(zip(), new Uint8Array([1])))).toThrow('损坏');
  });
  it.each([1, 0x40, 0x2000])('拒绝加密标志 %s', flag => {
    expect(() => extract(patch((data, directory) => {
      set16(data, 6, flag); set16(data, directory + 8, flag);
    }))).toThrow('加密');
  });
  it.each([0x0001, 0x0017, 0x7075, 0x9901])('拒绝不支持/歧义的 ZIP 额外字段 %#', id => {
    const data = zipSync({ 'word/document.xml': strToU8(document(paragraph('正文'))) }, { extra: { [id]: new Uint8Array(4) } });
    expect(() => extract(data)).toThrow('损坏');
  });
  it.each(['local', 'central'])('校验 %s 额外字段内部的长度', location => {
    const data = zipSync({ 'word/document.xml': strToU8(document(paragraph('正文'))) }, { extra: { 0xcafe: new Uint8Array(4) } });
    const extra = location === 'local' ? 30 + u16(data, 26) : central(data) + 46 + u16(data, central(data) + 28);
    set16(data, extra + 2, 100);
    expect(() => extract(data)).toThrow('损坏');
  });
  it('中央目录排序可与本地记录顺序不同', () => {
    const data = zip(undefined, 6, { 'word/other.xml': strToU8('其他内容') });
    const directory = central(data);
    const second = directory + 46 + u16(data, directory + 28) + u16(data, directory + 30) + u16(data, directory + 32);
    const reordered = join(data.subarray(0, directory), data.subarray(second, -22), data.subarray(directory, second), data.subarray(-22));
    expect(extract(reordered)).toBe('合同正文');
  });
  it('拒绝中央目录完全遗漏的本地条目', () => {
    const data = zip(undefined, 6, { 'word/hidden.xml': strToU8('隐藏') });
    const directory = central(data);
    const firstLength = 46 + u16(data, directory + 28) + u16(data, directory + 30) + u16(data, directory + 32);
    const orphan = join(data.subarray(0, directory + firstLength), data.subarray(-22));
    set16(orphan, orphan.length - 14, 1); set16(orphan, orphan.length - 12, 1);
    set32(orphan, orphan.length - 10, firstLength);
    expect(() => extract(orphan)).toThrow('损坏');
  });
  it('拒绝损坏的数据描述符', () => {
    const data = withDescriptor(true);
    data[central(data) - 12] ^= 1;
    expect(() => extract(data)).toThrow('损坏');
  });
  it.each(['../evil.xml', '/evil.xml', 'C:/evil.xml', 'word\\evil.xml', 'word/./evil.xml', 'word//evil.xml', 'word/%2e%2e/evil.xml', 'word/evil\0.xml'])('拒绝无关部件的异常路径 %s', name => {
    expect(() => extract(zip(undefined, 6, { [name]: new Uint8Array() }))).toThrow('损坏');
  });
  it('拒绝真实重复正文条目（不是对象键覆盖的伪测试）', () => {
    const data = zip(undefined, 6, { 'word/duplicat.xml': strToU8(document(paragraph('另一个正文'))) });
    const directory = central(data);
    const secondCentral = directory + 46 + u16(data, directory + 28) + u16(data, directory + 30) + u16(data, directory + 32);
    const secondLocal = u32(data, secondCentral + 42);
    data.set(strToU8('word/document.xml'), secondLocal + 30);
    data.set(strToU8('word/document.xml'), secondCentral + 46);
    expect(() => extract(data)).toThrow('重复');
  });
  it('拒绝大小写正文别名', () => {
    expect(() => extract(zip(undefined, 6, { 'WORD/DOCUMENT.XML': strToU8('重复') }))).toThrow('重复');
  });
  it('少报条目数不能隐藏后续本地记录', () => {
    const data = zip(undefined, 6, { 'word/hidden.xml': strToU8('隐藏') });
    set16(data, data.length - 14, 1); set16(data, data.length - 12, 1);
    expect(() => extract(data)).toThrow('损坏');
  });
});

describe('DEFLATE 结束与损坏检查（不能只信 fflate final 参数）', () => {
  it.each([constants.Z_DEFAULT_STRATEGY, constants.Z_FILTERED, constants.Z_HUFFMAN_ONLY, constants.Z_RLE, constants.Z_FIXED])('兼容独立 zlib 编码器的策略 %s 与不同压缩级别', strategy => {
    const text = Array.from({ length: 3000 }, (_, index) => String.fromCharCode(0x4e00 + (index * 179) % 20000)).join('') + '租赁合同正文'.repeat(500);
    const xml = document(paragraph(text));
    for (const level of [0, 1, 6, 9]) {
      expect(extract(rawDeflate(deflateRawSync(strToU8(xml), { strategy, level }), xml))).toBe(text);
    }
  });
  it('拒绝被补齐 ZIP 元数据的压缩流截断', () => {
    const xml = document(paragraph('正文')), raw = deflateSync(strToU8(xml));
    expect(() => extract(rawDeflate(raw.subarray(0, -1), xml))).toThrow('损坏');
  });
  it('拒绝结束块之后的尾随压缩垃圾', () => {
    const xml = document(paragraph('正文')), raw = deflateSync(strToU8(xml));
    expect(() => extract(rawDeflate(join(raw, new Uint8Array([0, 0])), xml))).toThrow('损坏');
  });
  it('拒绝缺失 BFINAL，尽管实际内容、CRC、大小完全一致', () => {
    const xml = document(paragraph('正文')), raw = deflateSync(strToU8(xml), { level: 0 });
    raw[0] &= 0xfe;
    expect(() => extract(rawDeflate(raw, xml))).toThrow('损坏');
  });
  it('验证存储 DEFLATE 块 NLEN（fflate 本身不验证）', () => {
    const xml = document(paragraph('正文')), raw = deflateSync(strToU8(xml), { level: 0 });
    expect(extract(rawDeflate(raw, xml))).toBe('正文');
    raw[3] ^= 1;
    expect(() => extract(rawDeflate(raw, xml))).toThrow('损坏');
  });
  it('拒绝保留块类型、空压缩流与无历史距离', () => {
    const xml = document(paragraph('正文'));
    for (const raw of [new Uint8Array([7]), new Uint8Array(), new Uint8Array([3, 2, 0])]) {
      expect(() => extract(rawDeflate(raw, xml))).toThrow('损坏');
    }
  });
});

describe('XML 安全与错误', () => {
  it.each([
    '<!DOCTYPE w:document [<!ENTITY secret "危险">]>',
    '<!DOCTYPE w:document SYSTEM "https://invalid.test/private">',
    '<!ENTITY secret SYSTEM "file:///private/secret">',
  ])('在 DOMParser 前拒绝声明 %s', declaration => {
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    expect(() => extract(zip(declaration + document(paragraph('&secret;'))))).toThrow(/DOCTYPE|ENTITY/);
    expect(parse).not.toHaveBeenCalled();
  });
  it('UTF-16 编码不能绕过实体声明防护', () => {
    const xml = '\uFEFF<!DOCTYPE w:document [<!ENTITY x "危险">]>' + document(paragraph('&x;'));
    const bytes = new Uint8Array(xml.length * 2);
    for (let n = 0; n < xml.length; n++) view(bytes).setUint16(n * 2, xml.charCodeAt(n), true);
    expect(() => extract(zipSync({ 'word/document.xml': bytes }))).toThrow('DOCTYPE');
  });
  it.each([
    document(paragraph('正文')).replace('</w:r>', ''),
    document(paragraph('&unknown;')),
    document(paragraph('正文')).replace('</w:document>', '</w:document><extra/>'),
    document(paragraph('正文'), 'https://invalid.test/fake-word'),
    document(paragraph('正文')).replace('w:body', 'w:other'),
    document(paragraph('正文')).replace('</w:body>', '</w:body><w:body/>'),
    '<?xml version="1.0" encoding="GB18030"?>' + document(paragraph('正文')),
  ])('损坏 XML/命名空间/正文结构必须抛错而非空内容 %#', xml => {
    expect(() => extract(zip(xml))).toThrow('损坏');
  });
  it('拒绝无效 UTF-8，而非替换后继续解析', () => {
    const bytes = strToU8(document(paragraph('正文')));
    bytes[10] = 0xff;
    expect(() => extract(zipSync({ 'word/document.xml': bytes }))).toThrow('损坏');
  });
  it('DOMParser 失败返回中文错误', () => {
    vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(() => { throw new Error('parser failed'); });
    expect(() => extract(zip())).toThrow('损坏');
  });
  it('限制嵌套深度，避免递归栈耗尽', () => {
    const body = '<w:customXml>'.repeat(257) + paragraph('正文') + '</w:customXml>'.repeat(257);
    expect(() => extract(zip(document(body)))).toThrow('嵌套过深');
  });
});
