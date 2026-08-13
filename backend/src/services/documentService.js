import fs from 'fs/promises';
import path from 'path';
import iconv from 'iconv-lite';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

// 文档解析服务：支持 TXT / MD / PDF / Word 文件内容抽取
async function readTxtWithFallback(filePath) {
  const buffer = await fs.readFile(filePath);

  const utf8Text = buffer.toString('utf8');
  if (utf8Text && !utf8Text.includes('�')) {
    return utf8Text;
  }

  const gbkText = iconv.decode(buffer, 'gbk');
  if (gbkText && !gbkText.includes('�')) {
    return gbkText;
  }

  const gb2312Text = iconv.decode(buffer, 'gb2312');
  if (gb2312Text && !gb2312Text.includes('�')) {
    return gb2312Text;
  }

  return utf8Text;
}

export async function extractTextFromFile(filePath, fileType) {
  const ext = fileType.toLowerCase();
  if (ext === 'txt' || ext === 'md') {
    return readTxtWithFallback(filePath);
  }

  if (ext === 'pdf') {
    const buffer = await fs.readFile(filePath);
    const result = await pdfParse(buffer);
    return result.text || '';
  }

  if (ext === 'docx') {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  throw new Error(`不支持的文件类型：${path.extname(filePath)}`);
}

// 将 docx 转换为内嵌图片的 HTML，用于保留文档中的原始图片预览。
// 图片以 data URI 形式直接嵌入，转换过程不写盘、不落库。
export async function docxToPreviewHtml(filePath) {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement((element) =>
        element.readAsBase64String().then((base64) => ({
          src: `data:${element.contentType};base64,${base64}`
        }))
      )
    }
  );
  return result.value || '';
}

function normalizeChunkText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findNaturalBoundary(text, start, end) {
  if (end >= text.length) return text.length;

  const windowStart = Math.max(start + Math.floor((end - start) * 0.55), end - 180);
  const candidates = [
    /[。！？!?]/g,
    /\n{2,}/g,
    /[；;]/g,
    /[，,]/g
  ];

  for (const pattern of candidates) {
    pattern.lastIndex = windowStart;
    let match;
    let boundary = -1;
    while ((match = pattern.exec(text)) && match.index < end) {
      boundary = match.index + match[0].length;
    }
    if (boundary > start) return boundary;
  }

  return end;
}

// 切分为保留原文定位信息的 RAG chunk，优先在自然语义边界处断开。
export function splitTextIntoChunks(text, chunkSize = 500, overlap = 100) {
  const cleanText = normalizeChunkText(text);
  if (!cleanText) return [];

  const safeChunkSize = Math.max(100, Number(chunkSize) || 500);
  const safeOverlap = Math.max(0, Math.min(Number(overlap) || 0, safeChunkSize - 1));
  const chunks = [];
  let startOffset = 0;

  while (startOffset < cleanText.length) {
    const preferredEnd = Math.min(startOffset + safeChunkSize, cleanText.length);
    const endOffset = findNaturalBoundary(cleanText, startOffset, preferredEnd);
    const content = cleanText.slice(startOffset, endOffset).trim();

    if (content) {
      const contentStart = cleanText.indexOf(content, startOffset);
      chunks.push({
        chunkIndex: chunks.length,
        content,
        charCount: content.length,
        tokenCount: Math.ceil(content.length / 2),
        startOffset: contentStart,
        endOffset: contentStart + content.length
      });
    }

    if (endOffset >= cleanText.length) break;
    startOffset = Math.max(endOffset - safeOverlap, startOffset + 1);
  }

  return chunks;
}
