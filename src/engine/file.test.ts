import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_TEXT_LENGTH, readContractFile } from './file';

describe('本地纯文本导入', () => {
  it('读取 UTF-8 BOM 与中文，不执行 HTML', async () => {
    const text = '<img src=x onerror=alert(1)>房屋租赁合同：押金任意扣除。';
    expect(await readContractFile(new File(['\uFEFF' + text], '合同.txt'))).toBe(text);
  });
  it('兼容 GB18030 编码', async () => {
    const bytes = new Uint8Array([0xd7, 0xe2, 0xb7, 0xbf]); // 租房
    expect(await readContractFile(new File([bytes], 'contract.TXT'))).toBe('租房');
  });
  it('拒绝非 txt，不静默假装支持 Word/PDF', async () => {
    await expect(readContractFile(new File(['正文'], '合同.pdf'))).rejects.toThrow('只支持 .txt');
  });
  it('拒绝超大文件', async () => {
    await expect(readContractFile(new File(['x'.repeat(MAX_FILE_BYTES + 1)], 'large.txt'))).rejects.toThrow('超过 200 KB');
  });
  it('拒绝超过字符上限的文本', async () => {
    await expect(readContractFile(new File(['x'.repeat(MAX_TEXT_LENGTH + 1)], 'long.txt'))).rejects.toThrow('50,000');
  });
  it('拒绝空白与二进制伪装', async () => {
    await expect(readContractFile(new File([' \r\n'], 'empty.txt'))).rejects.toThrow('为空');
    await expect(readContractFile(new File(['abc\0def'], 'binary.txt'))).rejects.toThrow('不像纯文本');
  });
  it('接受上限内文本，不截断内容', async () => {
    const text = '合'.repeat(MAX_TEXT_LENGTH);
    expect((await readContractFile(new File([text], 'limit.txt'))).length).toBe(MAX_TEXT_LENGTH);
  });
});
