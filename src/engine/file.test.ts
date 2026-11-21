// @vitest-environment jsdom
import { File as NodeFile } from 'node:buffer';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_DOCX_BYTES, MAX_FILE_BYTES, MAX_TEXT_LENGTH, readContractFile } from './file';

// jsdom 26 File has no arrayBuffer(); keep its real DOMParser but use Node's File for input.
const TestFile = NodeFile as unknown as typeof File;
const xml = (text: string) => `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
const docx = (text: string) => zipSync({ 'word/document.xml': strToU8(xml(text)) });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('本地纯文本导入', () => {
  it('读取 UTF-8 BOM 与中文，不执行 HTML', async () => {
    const text = '<img src=x onerror=alert(1)>房屋租赁合同：押金任意扣除。';
    expect(await readContractFile(new TestFile(['\uFEFF' + text], '合同.txt'))).toBe(text);
  });
  it('兼容 GB18030 编码', async () => {
    const bytes = new Uint8Array([0xd7, 0xe2, 0xb7, 0xbf]); // 租房
    expect(await readContractFile(new TestFile([bytes], 'contract.TXT'))).toBe('租房');
  });
  it('拒绝其他格式，不静默假装支持 PDF', async () => {
    await expect(readContractFile(new TestFile(['正文'], '合同.pdf'))).rejects.toThrow('只支持 .txt');
  });
  it('保持 200 KB 精确字节边界（先检查字节，再检查字符）', async () => {
    await expect(readContractFile(new TestFile(['x'.repeat(MAX_FILE_BYTES)], 'limit.txt'))).rejects.toThrow('50,000');
    await expect(readContractFile(new TestFile(['x'.repeat(MAX_FILE_BYTES + 1)], 'large.txt'))).rejects.toThrow('超过 200 KB');
  });
  it('拒绝超过字符上限的文本', async () => {
    await expect(readContractFile(new TestFile(['x'.repeat(MAX_TEXT_LENGTH + 1)], 'long.txt'))).rejects.toThrow('50,000');
  });
  it('拒绝空白、零字节与二进制伪装', async () => {
    await expect(readContractFile(new TestFile([], 'empty.txt'))).rejects.toThrow('为空');
    await expect(readContractFile(new TestFile([' \r\n'], 'empty.txt'))).rejects.toThrow('为空');
    await expect(readContractFile(new TestFile(['abc\0def'], 'binary.txt'))).rejects.toThrow('不像纯文本');
  });
  it('编码错误不吞成空内容', async () => {
    await expect(readContractFile(new TestFile([new Uint8Array([0xff])], 'bad.txt'))).rejects.toThrow('编码');
  });
  it('接受上限内文本，不截断或归一化空白', async () => {
    const text = '合'.repeat(MAX_TEXT_LENGTH);
    expect(await readContractFile(new TestFile([text], 'limit.txt'))).toBe(text);
    expect(await readContractFile(new TestFile([' 合同\t正文\r\n'], 'space.txt'))).toBe(' 合同\t正文\r\n');
  });
});

describe('本地 DOCX 导入入口', () => {
  it('按扩展名读取 DOCX，不依赖 MIME', async () => {
    expect(await readContractFile(new TestFile([docx('租赁合同')], '合同.DOCX', { type: 'application/octet-stream' }))).toBe('租赁合同');
  });
  it('旧 .doc 使用明确的中文转换提示', async () => {
    await expect(readContractFile(new TestFile(['正文'], '合同.DOC'))).rejects.toThrow('旧版 .doc');
  });
  it('空文件、伪装正文、OLE 加密容器均不伪装成成功', async () => {
    await expect(readContractFile(new TestFile([], '空.docx'))).rejects.toThrow('为空');
    await expect(readContractFile(new TestFile(['这不是 ZIP 文件'], '伪装.docx'))).rejects.toThrow('损坏');
    await expect(readContractFile(new TestFile([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])], '加密.docx'))).rejects.toThrow('损坏');
  });
  it('允许恰好 2 MB，拒绝多一个字节且不读取超限文件', async () => {
    const make = (padding: number) => zipSync({
      'word/document.xml': strToU8(xml('正文')),
      'word/media/padding.bin': new Uint8Array(padding),
    }, { level: 0 });
    const archive = make(MAX_DOCX_BYTES - make(0).length);
    expect(archive.length).toBe(MAX_DOCX_BYTES);
    expect(await readContractFile(new TestFile([archive], '边界.docx'))).toBe('正文');
    const oversized = new TestFile([archive, new Uint8Array(1)], '超限.docx');
    const read = vi.spyOn(oversized, 'arrayBuffer');
    await expect(readContractFile(oversized)).rejects.toThrow('超过 2 MB');
    expect(read).not.toHaveBeenCalled();
  });
  it('正文字符精确边界沿用 UTF-16 string.length，不计包装 XML', async () => {
    const text = '合'.repeat(MAX_TEXT_LENGTH);
    expect(await readContractFile(new TestFile([docx(text)], '边界.docx'))).toBe(text);
    await expect(readContractFile(new TestFile([docx(text + '同')], '超限.docx'))).rejects.toThrow('50,000');
    expect((await readContractFile(new TestFile([docx('\u{20000}'.repeat(25_000))], '补充汉字.docx'))).length).toBe(50_000);
  });
  it('本地读取失败返回中文错误，不吞错或泄露底层异常', async () => {
    const file = new TestFile([], '合同.docx');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('private file details'));
    await expect(readContractFile(file)).rejects.toThrow('无法读取文件');
  });
  it('成功或失败均不上传、不记录合同、不持久化', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const indexedDB = { open: vi.fn() };
    vi.stubGlobal('indexedDB', indexedDB);
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map(method => vi.spyOn(console, method as 'log'));
    expect(await readContractFile(new TestFile([docx('保密合同')], '保密.docx'))).toBe('保密合同');
    await expect(readContractFile(new TestFile(['bad'], '损坏.docx'))).rejects.toThrow('损坏');
    for (const spy of [fetch, xhr, storage, indexedDB.open, ...logs]) expect(spy).not.toHaveBeenCalled();
  });
});
