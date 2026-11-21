import { extractDocxText, MAX_DOCX_BYTES } from './docx';

export { MAX_DOCX_BYTES } from './docx';
export const MAX_TEXT_LENGTH = 50_000;
export const MAX_FILE_BYTES = 200 * 1024;

/** Reads locally; the File is never sent to a service or retained in persistent storage. */
export async function readContractFile(file: File): Promise<string> {
  if (/\.doc$/i.test(file.name)) throw new Error('暂不支持旧版 .doc 格式，请在 Word/WPS 中另存为 .docx，或直接复制正文粘贴。');
  const docx = /\.docx$/i.test(file.name);
  if (!docx && !/\.txt$/i.test(file.name)) throw new Error('只支持 .txt 纯文本或 .docx 文件，请将其他格式的合同正文复制粘贴到输入框。');
  const sizeError = docx ? 'DOCX 文件超过 2 MB，请删去附件或分段导入。' : '文件超过 200 KB，请删去附件或分段粘贴合同正文。';
  const limit = docx ? MAX_DOCX_BYTES : MAX_FILE_BYTES;
  if (file.size > limit) throw new Error(sizeError);
  let buffer: ArrayBuffer;
  try { buffer = await file.arrayBuffer(); }
  catch { throw new Error('无法读取文件，请重新选择本地文件后重试。'); }
  if (buffer.byteLength > limit) throw new Error(sizeError);
  if (docx) return extractDocxText(new Uint8Array(buffer), MAX_TEXT_LENGTH);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try { text = new TextDecoder('gb18030', { fatal: true }).decode(buffer); }
    catch { throw new Error('无法读取文字编码，请另存为 UTF-8 格式的 .txt 文件。'); }
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw new Error('文件不像纯文本，请另存为 UTF-8 格式的 .txt 文件。');
  text = text.replace(/^\uFEFF/, '');
  if (text.length > MAX_TEXT_LENGTH) throw new Error('文字超过 50,000 字符，请分段审阅。');
  if (!text.trim()) throw new Error('文件内容为空，请选择包含合同正文的 .txt 文件。');
  return text;
}
