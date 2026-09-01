import KnowledgeChunk from '../models/KnowledgeChunk.js';
// @ts-ignore - segmentit (CJS) 无类型声明，运行时经 default 导出
import segmentitModule from 'segmentit';

const { Segment, useDefault } = segmentitModule;
const segment = useDefault(new Segment());

const K1 = 1.2;
const B = 0.75;
const RRF_K = 60;

const STOP_WORDS = new Set([
  '的', '了', '和', '是', '我', '你', '他', '她', '它', '吗', '呢', '啊', '哦', '嗯', '吧', '呀', '嘛', '哪', '么', '怎',
  '请问', '怎么', '如何', '什么', '在哪', '哪里', '怎样', '怎么样', '哪个', '哪些', '可以', '能够',
  '应该', '需要', '想要', '会', '能', '要', '想', '问', '说', '看', '去', '来', '在', '有', '为',
  '与', '及', '或', '但', '而', '也', '都', '就', '还', '一个', '这个', '那个', '我们', '你们',
  '他们', '以及', '关于', '对于', '根据', '按照', '如果', '因为', '所以', '然后', '但是', '不过', '并且'
]);

const SINGLE_ASCII = /^[a-z0-9]$/;

// 中文分词 + 英文整词，过滤停用词与单字符噪声。
export function tokenize(text) {
  const input = String(text || '');
  if (!input.trim()) return [];
  const words = segment.doSegment(input, { simple: true });
  return (Array.isArray(words) ? words : [])
    .map((word) => String(word).trim().toLowerCase())
    .filter((word) => word && !STOP_WORDS.has(word) && !SINGLE_ASCII.test(word));
}

function getTermFreqMap(terms) {
  const map = new Map();
  for (const term of terms) map.set(term, (map.get(term) || 0) + 1);
  return map;
}

function buildCorpusStats(chunks) {
  const df = new Map();
  let totalLen = 0;
  for (const chunk of chunks) {
    const terms = tokenize(chunk.content);
    totalLen += terms.length;
    for (const term of new Set(terms)) df.set(term, (df.get(term) || 0) + 1);
  }
  return {
    N: chunks.length,
    avgdl: chunks.length ? totalLen / chunks.length : 0,
    df
  };
}

function scoreBM25(queryTerms, docTerms, stats) {
  if (!docTerms.length || !stats.avgdl) return 0;
  const { df, N, avgdl } = stats;
  const tfMap = getTermFreqMap(docTerms);
  let score = 0;
  for (const term of new Set(queryTerms)) {
    const tf = tfMap.get(term) || 0;
    if (!tf) continue;
    const dfTerm = df.get(term) || 0;
    const idf = Math.log(1 + (N - dfTerm + 0.5) / (dfTerm + 0.5));
    const denominator = tf + K1 * (1 - B + B * (docTerms.length / Math.max(avgdl, 1)));
    score += idf * ((tf * (K1 + 1)) / denominator);
  }
  return score;
}

/**
 * 从 MongoDB 的 KnowledgeChunk 里做 chunk 级 BM25 召回。
 * 中小型知识库直接全量扫描即可；数据量上来后可改为倒排索引缓存。
 */
export async function retrieveByBM25(question, { categoryId, topK = 30 } = {}) {
  const queryTerms = [...new Set(tokenize(question))];
  if (queryTerms.length === 0) return [];

  const filter = {};
  if (categoryId) filter.categoryId = categoryId;

  const chunks = await KnowledgeChunk.find(filter, {
    _id: 1,
    documentId: 1,
    categoryId: 1,
    chunkIndex: 1,
    title: 1,
    content: 1
  }).lean();

  if (chunks.length === 0) return [];

  const stats = buildCorpusStats(chunks);

  return chunks
    .map((chunk) => ({
      chunk,
      score: scoreBM25(queryTerms, tokenize(chunk.content), stats)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk, score }) => ({
      id: String(chunk._id),
      content: chunk.content,
      metadata: {
        documentId: String(chunk.documentId || ''),
        categoryId: String(chunk.categoryId || ''),
        title: chunk.title || '',
        chunkIndex: Number(chunk.chunkIndex || 0)
      },
      bm25Score: Number(score)
    }));
}

// 稠密 + 稀疏结果做 Reciprocal Rank Fusion 融合。
export function fuseRanks(denseHits, bm25Hits, topK = 5) {
  const map = new Map();

  const getOrCreate = (id) => {
    let item = map.get(id);
    if (!item) {
      item = { id, content: '', metadata: null, denseScore: 0, bm25Score: 0, fusedScore: 0, score: 0 };
      map.set(id, item);
    }
    return item;
  };

  denseHits.forEach((hit, index) => {
    const item = getOrCreate(String(hit.id));
    item.fusedScore += 1 / (RRF_K + index + 1);
    item.denseScore = Math.max(item.denseScore, Number(hit.score || 0));
    item.score = item.denseScore;
    item.content = item.content || hit.content || '';
    item.metadata = item.metadata || hit.metadata || null;
  });

  bm25Hits.forEach((hit, index) => {
    const item = getOrCreate(String(hit.id));
    item.fusedScore += 1 / (RRF_K + index + 1);
    item.bm25Score = Math.max(item.bm25Score, Number(hit.bm25Score || 0));
    item.content = item.content || hit.content || '';
    item.metadata = item.metadata || hit.metadata || null;
  });

  return [...map.values()]
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, topK);
}