export const MAX_TEXT_LENGTH = 50_000;
export const MAX_FILE_BYTES = 200 * 1024;

/** Reads locally; the File is never sent to a service or retained in persistent storage. */
export async function readContractFile(file: File): Promise<string> {
  if (!/\.txt$/i.test(file.name)) throw new Error('暂时只支持 .txt 纯文本文件，请将合同正文复制粘贴到输入框。');
  if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 200 KB，请删去附件或分段粘贴合同正文。');
  const buffer = await file.arrayBuffer();
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
