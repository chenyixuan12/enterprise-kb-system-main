import { Router } from 'express';
import mongoose from 'mongoose';
import KnowledgeDocument from '../models/KnowledgeDocument.js';
import KnowledgeCategory from '../models/knowledgeCategory.js';
import ChatSession from '../models/ChatSession.js';
import QALog from '../models/QALog.js';
import { generateAnswerStream, embedQuery } from '../services/ollamaService.js';
import { queryChunks } from '../services/chromaService.js';
import { retrieveByBM25, fuseRanks, tokenize } from '../services/bm25Service.js';
import { rerankChunks } from '../services/rerankService.js';
import { config } from '../config/env.js';
import { getRequestUser } from '../utils/auth.js';

const router = Router();
const MAX_RECALL_CHUNKS = 5;
const MAX_SOURCE_DOCS = 3;
const MAX_CONTEXT_CHARS = 6000;
const SOURCE_SCORE_THRESHOLD = 0.2;
const LOW_MATCH_THRESHOLD = 4;
const RECOMMENDATION_MIN_SCORE = LOW_MATCH_THRESHOLD;
// 召回阶段各路的候选条数：稠密向量和 BM25 都先多取一些，再融合精排到最终 topK。
const DENSE_RECALL_K = 30;
const BM25_RECALL_K = 30;
// RRF 融合后的候选条数：先保留更多候选，交给重排模型精排后再截断到最终 topK。
const RERANK_RECALL_K = 15;
// 只有当稠密相似度达到该值才算“语义上确实相关”，避免只靠标题关键词误判。
const DENSE_CONFIRM_THRESHOLD = 0.5;
// 重排分达到该值视为强相关证据（gte-rerank 类模型分数通常在 0~1）。
const RERANK_CONFIRM_THRESHOLD = 0.5;
// LLM 答不出内容时常见的兜底短语，命中后视为当前知识库未真正回答，转而推荐其他知识库。
const NON_ANSWER_MARKERS = ['无法确定', '暂时无法', '没有找到', '未找到', '暂未找到', '找不到', '无法回答', '没有相关', '未提及', '暂无法', '没有信息', '无相关内容'];

function sendSSE(res, type, data) {
  try {
    const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(message);
    if (typeof res.flush === 'function') {
      res.flush();
    }
  } catch (error) {
    console.error('[QA] SSE发送失败:', error);
  }
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeywords(question) {
  const normalized = normalizeText(question);
  
  // 使用 n-gram 分词方法
  const words = new Set();
  
  // 2-gram 和 3-gram
  for (let i = 0; i < normalized.length - 1; i++) {
    words.add(normalized.slice(i, i + 2)); // 2-gram
    if (i < normalized.length - 2) {
      words.add(normalized.slice(i, i + 3)); // 3-gram
    }
  }
  
  // 同时保留原有的单词分割
  normalized.split(' ').filter(Boolean).forEach(w => {
    if (w.length >= 2) words.add(w);
  });
  
  const stopWords = new Set([
    '的', '了', '和', '是', '我', '你', '他', '她', '它', '吗', '呢', '啊', 
    '请问', '怎么', '如何', '什么', '在哪', '哪里', '怎样', '怎么样', 
    '这个', '那个', '哪个', '可以', '能够', '应该', '需要', '想要',
    '会', '能', '要', '想', '问', '说', '看', '去', '来', '在', '有', 
    '为', '与', '及', '或', '但', '而', '也', '都', '就', '还'
  ]);
  
  return [...words].filter((w) => w.length >= 2 && !stopWords.has(w)).slice(0, 20);
}

function scoreDocument(doc, keywords, categoryId) {
  let score = 0;
  const title = normalizeText(doc.title);
  const originalName = normalizeText(doc.originalName);
  const content = normalizeText(doc.content || '');
  const fullText = `${title} ${originalName} ${content}`;

  if (categoryId && String(doc.categoryId || '') === String(categoryId)) {
    score += 2;
  }

  // 标题/文件名强匹配，优先保证问题能落到正确文档
  for (const kw of keywords) {
    if (!kw) continue;

    if (title === kw || title.includes(kw)) {
      score += 28;
    }
    if (originalName === kw || originalName.includes(kw)) {
      score += 16;
    }
    if (content.slice(0, 1000).includes(kw)) {
      score += 8;
    }
    if (content.includes(kw)) {
      score += 4;
    }
  }

  // 关键短语优先：如果问题的大部分词都能在标题里出现，直接强拉高分
  const matchedInTitle = keywords.filter((kw) => title.includes(kw)).length;
  const matchedInName = keywords.filter((kw) => originalName.includes(kw)).length;
  const matchedInContent = keywords.filter((kw) => content.includes(kw)).length;

  if (keywords.length > 0) {
    const titleRatio = matchedInTitle / keywords.length;
    const nameRatio = matchedInName / keywords.length;
    const contentRatio = matchedInContent / keywords.length;
    score += Math.round(titleRatio * 36);
    score += Math.round(nameRatio * 18);
    score += Math.round(contentRatio * 10);
  }

  // 适度奖励正文完整度，但不要压过标题命中
  const contentLength = fullText.length;
  if (contentLength > 200 && contentLength < 30000) {
    score += 3;
  }

  if (doc.status === 'processed') {
    score += 1;
  }

  return score;
}

function buildContext(chunksWithContent) {
  let output = '';
  for (const item of chunksWithContent) {
    const snippet = String(item.content || '').replace(/\s+/g, ' ').trim();
    const block = `【资料：${item.title || '未命名文档'}｜片段 ${Number(item.chunkIndex || 0) + 1}】\n${snippet}\n\n`;
    if ((output + block).length > MAX_CONTEXT_CHARS) break;
    output += block;
  }
  return output.trim();
}

function buildPrompt(question, context) {
  if (!context) {
    return `你是企业内部知识库的可对话专家 Agent。\n请严格基于给定的知识内容回答用户问题，不要编造。\n如果知识内容不足，请明确说明“根据当前知识库内容暂时无法确定”。\n\n当前知识库中没有检索到相关内容。\n\n用户问题：${question}\n\n请直接给出中文答案。`;
  }

  return `你是企业内部知识库的可对话专家 Agent。\n请严格基于以下知识内容回答用户问题，不要编造。\n如果知识内容不足，请明确说明“根据当前知识库内容暂时无法确定”。\n\n知识内容：\n${context}\n\n用户问题：${question}\n\n请直接给出中文答案。`;
}

function pickTopSources(retrievedChunks, limit = MAX_SOURCE_DOCS) {
  const sourceByDocumentId = new Map();

  for (const chunk of retrievedChunks) {
    if (!chunk.content || chunk.score < SOURCE_SCORE_THRESHOLD) continue;
    const documentId = String(chunk.metadata?.documentId || chunk.doc?._id || '');
    if (!documentId || sourceByDocumentId.has(documentId)) continue;

    sourceByDocumentId.set(documentId, {
      documentId,
      chunkId: String(chunk.id || ''),
      title: chunk.metadata?.title || chunk.doc?.title || '未命名文档',
      originalName: chunk.doc?.originalName || '',
      fileType: chunk.doc?.fileType || '',
      snippet: String(chunk.content).replace(/\s+/g, ' ').trim().slice(0, 300),
      categoryId: chunk.metadata?.categoryId || chunk.doc?.categoryId || null,
      chunkIndex: Number(chunk.metadata?.chunkIndex || 0),
      score: Number(chunk.score.toFixed(4))
    });
  }

  return [...sourceByDocumentId.values()].slice(0, limit);
}

function buildRecommendedKnowledge(scoredDocs, categoriesById) {
  const categoryStats = new Map();

  for (const item of scoredDocs) {
    const categoryId = String(item.doc.categoryId || '');
    if (!categoryId) continue;

    const currentScore = Math.max(0, Number(item.hybridScore || item.score || 0));
    const prev = categoryStats.get(categoryId) || { scores: [], topTitle: '', topScore: 0 };
    const scores = [...prev.scores, currentScore].sort((a, b) => b - a).slice(0, 3);
    const topScore = scores[0] || 0;

    categoryStats.set(categoryId, {
      scores,
      topTitle: currentScore >= prev.topScore ? item.doc.title : prev.topTitle,
      topScore
    });
  }

  return [...categoryStats.entries()]
    .map(([categoryId, stat]) => {
      const avgScore = stat.scores.length
        ? stat.scores.reduce((sum, score) => sum + score, 0) / stat.scores.length
        : 0;
      return {
        id: categoryId,
        name: categoriesById.get(categoryId) || '未知知识库',
        score: Number((avgScore + stat.topScore * 0.35).toFixed(2)),
        topTitle: stat.topTitle,
        topScore: Number(stat.topScore.toFixed(2)),
        hits: stat.scores.length
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function buildHybridCandidates(question, docs, { vectorHits = [], bm25Hits = [] } = {}) {
  const keywords = extractKeywords(question);

  const vectorScoreMap = new Map();
  for (const hit of vectorHits) {
    const documentId = String(hit.metadata?.documentId || '');
    if (!documentId) continue;
    const previousScore = vectorScoreMap.get(documentId) || 0;
    vectorScoreMap.set(documentId, Math.max(previousScore, Number(hit.score || 0)));
  }

  const bm25ScoreMap = new Map();
  for (const hit of bm25Hits) {
    const documentId = String(hit.metadata?.documentId || '');
    if (!documentId) continue;
    const previousScore = bm25ScoreMap.get(documentId) || 0;
    bm25ScoreMap.set(documentId, Math.max(previousScore, Number(hit.bm25Score || 0)));
  }

  return docs.map((doc) => {
    const keywordScore = scoreDocument(doc, keywords, null);
    const vectorScore = vectorScoreMap.get(String(doc._id)) || 0;
    const bm25Score = bm25ScoreMap.get(String(doc._id)) || 0;
    const hybridScore = keywordScore + vectorScore * 40 + Math.min(bm25Score, 8) * 5;

    return {
      doc,
      keywordScore,
      vectorScore,
      bm25Score,
      hybridScore,
      content: String(doc.content || '')
    };
  });
}

// 对融合后的候选做重排精排；未配置重排服务或调用失败时回退为 RRF 顺序截断。
async function rerankIfEnabled(question, fusedChunks, topK = MAX_RECALL_CHUNKS) {
  if (!fusedChunks || fusedChunks.length === 0) return [];
  if (!config.rerankEnabled || fusedChunks.length <= 1) {
    return fusedChunks.slice(0, topK);
  }
  try {
    const reranked = await rerankChunks(question, fusedChunks, { topK });
    console.log('[QA] 重排完成', reranked.map((c) => ({
      chunkId: c.id,
      title: c.metadata?.title,
      rerankScore: c.rerankScore
    })));
    return reranked;
  } catch (error) {
    console.error('[QA] 重排失败，回退 RRF 排序:', error?.message || error);
    return fusedChunks.slice(0, topK);
  }
}

// 判断当前知识库的召回结果是否足以回答：
// - 稠密相似度足够高（>= DENSE_CONFIRM_THRESHOLD）说明语义上确实相关；
// - 或者重排分足够高（>= RERANK_CONFIRM_THRESHOLD）说明交叉编码器判定强相关；
// - 或者稠密分不低且查询关键词能回到答案片段（含 BM25 命中）。
function hasAnswerEvidence(denseHits, fusedChunks, question) {
  if (!denseHits.length) return false;

  const bestDense = Math.max(...denseHits.map((hit) => Number(hit.score || 0)));
  const rerankScores = fusedChunks.map((chunk) => Number(chunk.rerankScore || 0));
  const bestRerank = rerankScores.length ? Math.max(...rerankScores) : 0;
  const bm25Scores = fusedChunks.map((chunk) => Number(chunk.bm25Score || 0));
  const bestBm25 = bm25Scores.length ? Math.max(...bm25Scores) : 0;

  const queryTerms = tokenize(question).filter((term) => term.length >= 2);
  const candidateText = fusedChunks
    .slice(0, 3)
    .map((chunk) => normalizeText(chunk.content || ''))
    .join(' ');

  const overlap = queryTerms.length
    ? queryTerms.filter((term) => candidateText.includes(term)).length
    : 0;
  const overlapRatio = queryTerms.length ? overlap / queryTerms.length : 0;

  // 1) 语义相似度过低，直接判定无答案。
  if (bestDense < SOURCE_SCORE_THRESHOLD) return false;
  // 2) 关键词命中比例过低，说明问题与当前片段内容无关，判定无答案。
  if (overlapRatio < 0.5) return false;

  // 语义足够强、重排分足够高、关键词命中足够多，或 BM25 有得分，满足其一即可认为有答案。
  return bestDense >= DENSE_CONFIRM_THRESHOLD
    || bestRerank >= RERANK_CONFIRM_THRESHOLD
    || overlapRatio >= 0.75
    || bestBm25 > 0;
}

// 当前知识库没有可靠结果时，在其他知识库中找出最相关的一个作为切换建议。
async function findAlternativeRecommendation(question, currentCategoryId, allDocs, categoriesById, questionEmbedding) {
  const otherDocs = allDocs.filter((doc) => String(doc.categoryId || '') !== String(currentCategoryId));
  const [globalDenseHits, globalBm25Hits] = await Promise.all([
    queryChunks(questionEmbedding, { topK: DENSE_RECALL_K }).catch(() => []),
    retrieveByBM25(question, { topK: BM25_RECALL_K }).catch(() => [])
  ]);

  const alternativeHybridDocs = await buildHybridCandidates(question, otherDocs, {
    vectorHits: globalDenseHits,
    bm25Hits: globalBm25Hits
  });

  // 推荐也必须达到“能回答问题”的语义证据线（DENSE_CONFIRM_THRESHOLD），
  // 否则说明所有知识库都没有相关内容，不应给出任何切换建议。
  const reliableDocs = alternativeHybridDocs.filter((item) => item.vectorScore >= DENSE_CONFIRM_THRESHOLD);

  const recommended = buildRecommendedKnowledge(reliableDocs, categoriesById);
  const top = recommended[0] || null;
  return { recommendedKnowledge: top ? recommended : [], suggestedCategory: top };
}

/**
 * @openapi
 * /api/qa/ask:
 *   post:
 *     tags: [QA]
 *     summary: 流式问答（SSE）
 *     description: |
 *       核心问答接口，返回 Server-Sent Events 流式响应（`text/event-stream`）。
 *
 *       **事件类型：**
 *       - `sources` — 召回的参考文档列表
 *       - `mismatch` — 当前知识库与问题不匹配，建议切换
 *       - `chunk` — LLM 生成的文本片段
 *       - `done` — 生成完成，包含完整答案和 sessionId
 *       - `error` — 发生错误
 *
 *       详细协议说明见文档首页「SSE 流式问答协议」章节。
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AskRequest'
 *     responses:
 *       200:
 *         description: SSE 流式响应
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               example: |
 *                 event: sources
 *                 data: [{"documentId":"...","title":"员工手册"}]
 *
 *                 event: chunk
 *                 data: "根据"
 *
 *                 event: done
 *                 data: {"answer":"完整答案","sessionId":"..."}
 *       400:
 *         description: 问题不能为空
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: 问答失败
 */
router.post('/ask', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { question, categoryId, sessionId } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ code: 400, message: '问题不能为空' });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    res.write(': 连接已建立\n\n');
    if (typeof res.flush === 'function') {
      res.flush();
    }

    console.log('[QA] SSE 连接已建立');

    // 获取所有文档（用于推荐最佳知识库）
    const allDocs = await KnowledgeDocument.find({}).lean();

    // 根据是否选择了知识库过滤文档
    console.log('[QA] 候选文档数量', allDocs.length);

    const categories = await KnowledgeCategory.find({}, { _id: 1, name: 1 }).lean();
    const categoriesById = new Map(categories.map((item) => [String(item._id), item.name]));

    const questionEmbedding = await embedQuery(question.trim());
    const currentCategory = categoryId ? categoriesById.get(String(categoryId)) : '';

    // 1) 对当前知识库做 chunk 级双路召回：Chroma 稠密 + BM25 稀疏，RRF 融合。
    let currentDenseHits = [];
    let currentBm25Hits = [];
    let fusedChunks = [];
    let currentHasGoodMatch = false;

    if (categoryId) {
      [currentDenseHits, currentBm25Hits] = await Promise.all([
        queryChunks(questionEmbedding, { categoryId, topK: DENSE_RECALL_K }).catch((error) => {
          console.error('[QA] 当前知识库向量召回失败', error?.message || error);
          return [];
        }),
        retrieveByBM25(question.trim(), { categoryId, topK: BM25_RECALL_K }).catch((error) => {
          console.error('[QA] 当前知识库 BM25 召回失败', error?.message || error);
          return [];
        })
      ]);
      fusedChunks = await rerankIfEnabled(
        question.trim(),
        fuseRanks(currentDenseHits, currentBm25Hits, RERANK_RECALL_K),
        MAX_RECALL_CHUNKS
      );
      currentHasGoodMatch = hasAnswerEvidence(currentDenseHits, fusedChunks, question.trim());
      console.log('[QA] 当前知识库召回', {
        denseHits: currentDenseHits.length,
        bm25Hits: currentBm25Hits.length,
        fused: fusedChunks.length,
        hasGoodMatch: currentHasGoodMatch
      });
    } else {
      // 未选知识库时全库检索直接回答
      const [globalDense, globalBm25] = await Promise.all([
        queryChunks(questionEmbedding, { topK: DENSE_RECALL_K }).catch(() => []),
        retrieveByBM25(question.trim(), { topK: BM25_RECALL_K }).catch(() => [])
      ]);
      fusedChunks = await rerankIfEnabled(
        question.trim(),
        fuseRanks(globalDense, globalBm25, RERANK_RECALL_K),
        MAX_RECALL_CHUNKS
      );
      currentHasGoodMatch = fusedChunks.length > 0;
    }

    const currentCategoryScore = currentDenseHits[0] ? Number(currentDenseHits[0].score) : 0;
    console.log('[QA] 融合后 chunk', fusedChunks.map((chunk) => ({
      chunkId: chunk.id,
      title: chunk.metadata?.title,
      denseScore: chunk.denseScore,
      bm25Score: chunk.bm25Score,
      fusedScore: chunk.fusedScore,
      rerankScore: chunk.rerankScore
    })));

    // 2) 当前知识库回答不了时，自动路由到最相关的其他知识库，重新检索并直接回答。
    let recommendedKnowledge = [];
    let suggestedCategory = null;
    let routedCategoryId = null;
    let routedCategoryName = '';
    let autoSwitched = false;

    if (categoryId && !currentHasGoodMatch) {
      const alt = await findAlternativeRecommendation(question.trim(), categoryId, allDocs, categoriesById, questionEmbedding);
      recommendedKnowledge = alt.recommendedKnowledge;
      suggestedCategory = alt.suggestedCategory;

      if (suggestedCategory && suggestedCategory.score >= RECOMMENDATION_MIN_SCORE) {
        // 自动路由：用推荐知识库重新做双路召回，确认有可靠答案后替换当前召回结果。
        const [routedDenseHits, routedBm25Hits] = await Promise.all([
          queryChunks(questionEmbedding, { categoryId: suggestedCategory.id, topK: DENSE_RECALL_K }).catch((error) => {
            console.error('[QA] 路由知识库向量召回失败', error?.message || error);
            return [];
          }),
          retrieveByBM25(question.trim(), { categoryId: suggestedCategory.id, topK: BM25_RECALL_K }).catch((error) => {
            console.error('[QA] 路由知识库 BM25 召回失败', error?.message || error);
            return [];
          })
        ]);

        const routedFusedChunks = await rerankIfEnabled(
          question.trim(),
          fuseRanks(routedDenseHits, routedBm25Hits, RERANK_RECALL_K),
          MAX_RECALL_CHUNKS
        );
        const routedHasGoodMatch = hasAnswerEvidence(routedDenseHits, routedFusedChunks, question.trim());

        if (routedHasGoodMatch) {
          fusedChunks = routedFusedChunks;
          currentHasGoodMatch = true;
          routedCategoryId = suggestedCategory.id;
          routedCategoryName = suggestedCategory.name;
          autoSwitched = true;

          sendSSE(res, 'mismatch', {
            message: `当前知识库「${currentCategory || '未命名'}」没有相关内容，已自动切换并参考「${routedCategoryName}」回答。`,
            autoSwitched: true,
            answeredByKnowledgeId: routedCategoryId,
            answeredByKnowledge: routedCategoryName,
            suggestedKnowledge: routedCategoryName,
            suggestedKnowledgeId: routedCategoryId,
            recommendedKnowledge: [],
            currentCategoryScore,
            suggestedCategoryScore: suggestedCategory.score,
            currentCategoryName: currentCategory || '',
            topMatchedDocument: '',
            isHighlyRelevant: true,
            scoreGap: Number((suggestedCategory.score - currentCategoryScore).toFixed(2)),
            shouldForceSwitch: false
          });
        } else {
          recommendedKnowledge = [];
          suggestedCategory = null;
          sendSSE(res, 'mismatch', {
            message: `当前知识库「${currentCategory || '未命名'}」没有相关内容，其他知识库也未检索到可靠答案。`,
            suggestedKnowledge: '',
            suggestedKnowledgeId: '',
            recommendedKnowledge: [],
            currentCategoryScore,
            suggestedCategoryScore: 0,
            currentCategoryName: currentCategory || '',
            topMatchedDocument: '',
            isHighlyRelevant: false,
            scoreGap: 0,
            shouldForceSwitch: false
          });
        }
      } else {
        recommendedKnowledge = [];
        suggestedCategory = null;
        sendSSE(res, 'mismatch', {
          message: `当前知识库「${currentCategory || '未命名'}」没有相关内容。`,
          suggestedKnowledge: '',
          suggestedKnowledgeId: '',
          recommendedKnowledge: [],
          currentCategoryScore,
          suggestedCategoryScore: 0,
          currentCategoryName: currentCategory || '',
          topMatchedDocument: '',
          isHighlyRelevant: false,
          scoreGap: 0,
          shouldForceSwitch: false
        });
      }
    }

    const retrievedChunks = currentHasGoodMatch ? fusedChunks : [];
    const context = currentHasGoodMatch ? buildContext(retrievedChunks) : '';
    console.log('[QA] 最终上下文长度', context.length);

    const sources = currentHasGoodMatch ? pickTopSources(retrievedChunks, MAX_SOURCE_DOCS) : [];
    console.log('[QA] 返回 sources 数量', sources.length);

    sendSSE(res, 'sources', sources);

    const prompt = buildPrompt(question.trim(), context);
    const finalSessionId = sessionId || Date.now().toString();
    let fullAnswer = '';

    let categoryName = '';
    if (categoryId) {
      const category = await KnowledgeCategory.findById(categoryId).lean();
      if (category) categoryName = category.name;
    }

    // 自动路由后，实际回答来自推荐知识库，日志与会话按实际回答库记录。
    const answeredCategoryId = autoSwitched ? routedCategoryId : (categoryId || null);
    const answeredCategoryName = autoSwitched ? routedCategoryName : categoryName;

    if (!currentHasGoodMatch) {
      const noMatchAnswer = suggestedCategory
        ? '当前知识库没有找到答案，已为你推荐更相关的知识库。'
        : '当前系统知识库无相关内容。';

      const responseTime = Date.now() - startTime;
      try {
        await QALog.create({
          question: question.trim(),
          answer: noMatchAnswer,
          categoryId: answeredCategoryId,
          categoryName: answeredCategoryName,
          userId: getRequestUser(req).userId || null,
          sources: [],
          sessionId: finalSessionId,
          responseTime,
          status: 'failed',
          errorMessage: noMatchAnswer
        });
        console.log('[QA] 问答日志已记录');
      } catch (logError) {
        console.error('[QA] 记录问答日志失败:', logError);
      }

      try {
        const userId = getRequestUser(req).userId;
        const userObjectId = userId && mongoose.Types.ObjectId.isValid(userId)
          ? new mongoose.Types.ObjectId(userId)
          : null;
        const categoryObjectId = answeredCategoryId && mongoose.Types.ObjectId.isValid(answeredCategoryId)
          ? new mongoose.Types.ObjectId(answeredCategoryId)
          : null;

        let session = null;
        if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
          session = await ChatSession.findById(sessionId);
        }

        if (!session) {
          session = new ChatSession({
            userId: userObjectId,
            categoryId: categoryObjectId,
            title: String(question || '').trim().slice(0, 18) || '新的对话',
            lastQuestion: String(question || ''),
            lastAnswer: noMatchAnswer,
            messageCount: 0,
            history: []
          });
        }

        session.userId = session.userId || userObjectId;
        session.categoryId = session.categoryId || categoryObjectId;
        session.title = session.title || String(question || '').trim().slice(0, 18) || '新的对话';
        session.lastQuestion = String(question || '');
        session.lastAnswer = noMatchAnswer;
        session.history = [
          { role: 'user', content: String(question || ''), sources: [] },
          { role: 'assistant', content: noMatchAnswer, sources: [] }
        ];
        session.messageCount = session.history.length;
        await session.save();
        console.log('[QA] 对话历史已记录', String(session._id));
      } catch (historyError) {
        console.error('[QA] 记录对话历史失败:', historyError);
      }

      sendSSE(res, 'done', {
        answer: noMatchAnswer,
        sessionId: finalSessionId,
        sources: [],
        recommendedKnowledge,
        suggestedKnowledge: suggestedCategory?.name || '',
        suggestedKnowledgeId: suggestedCategory?.id || ''
      });
      res.end();
      return;
    }

    try {
      console.log('[QA] 开始流式调用大模型...');
      fullAnswer = await generateAnswerStream(prompt, (chunk) => {
        sendSSE(res, 'chunk', chunk);
      });
      console.log('[QA] 大模型返回长度', String(fullAnswer || '').length);
    } catch (answerError) {
      console.error('[QA] 大模型调用失败:', answerError);
      sendSSE(res, 'error', { message: answerError.message });
      fullAnswer = '';
    }

    // 当前知识库召回到了内容，但 LLM 实际无法回答时，仍要去其他知识库找推荐，
    // 避免出现“答不出内容却没有给出任何切换建议”的情况。
    const answeredUncertain = !String(fullAnswer || '').trim()
      || NON_ANSWER_MARKERS.some((marker) => String(fullAnswer || '').includes(marker));
    if (categoryId && answeredUncertain && !suggestedCategory) {
      const alt = await findAlternativeRecommendation(question.trim(), categoryId, allDocs, categoriesById, questionEmbedding);
      recommendedKnowledge = alt.recommendedKnowledge;
      suggestedCategory = alt.suggestedCategory;

      if (suggestedCategory && suggestedCategory.score >= RECOMMENDATION_MIN_SCORE) {
        sendSSE(res, 'mismatch', {
          message: '当前知识库没有找到答案，已为你推荐更相关的知识库。',
          suggestedKnowledge: suggestedCategory.name,
          suggestedKnowledgeId: suggestedCategory.id,
          recommendedKnowledge,
          currentCategoryScore,
          suggestedCategoryScore: suggestedCategory.score,
          currentCategoryName: currentCategory || '',
          topMatchedDocument: '',
          isHighlyRelevant: false,
          scoreGap: Number((suggestedCategory.score - currentCategoryScore).toFixed(2)),
          shouldForceSwitch: false
        });
      } else {
        recommendedKnowledge = [];
        suggestedCategory = null;
        sendSSE(res, 'mismatch', {
          message: `当前知识库「${currentCategory || '未命名'}」没有相关内容。`,
          suggestedKnowledge: '',
          suggestedKnowledgeId: '',
          recommendedKnowledge: [],
          currentCategoryScore,
          suggestedCategoryScore: 0,
          currentCategoryName: currentCategory || '',
          topMatchedDocument: '',
          isHighlyRelevant: false,
          scoreGap: 0,
          shouldForceSwitch: false
        });
      }
    }

    const responseTime = Date.now() - startTime;
    try {
      await QALog.create({
        question: question.trim(),
        answer: fullAnswer || '根据当前知识库内容暂时无法确定。',
        categoryId: answeredCategoryId,
        categoryName: answeredCategoryName,
        userId: getRequestUser(req).userId || null,
        sources: sources.map((s) => s.title),
        sessionId: finalSessionId,
        responseTime,
        status: fullAnswer ? 'success' : 'failed',
        errorMessage: fullAnswer ? '' : '大模型调用失败'
      });
      console.log('[QA] 问答日志已记录');
    } catch (logError) {
      console.error('[QA] 记录问答日志失败:', logError);
    }

    try {
      const userId = getRequestUser(req).userId;
      const userObjectId = userId && mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId)
        : null;
      const categoryObjectId = answeredCategoryId && mongoose.Types.ObjectId.isValid(answeredCategoryId)
        ? new mongoose.Types.ObjectId(answeredCategoryId)
        : null;

      let session = null;
      if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
        session = await ChatSession.findById(sessionId);
      }

      if (!session) {
        session = new ChatSession({
          userId: userObjectId,
          categoryId: categoryObjectId,
          title: String(question || '').trim().slice(0, 18) || '新的对话',
          lastQuestion: String(question || ''),
          lastAnswer: String(fullAnswer || ''),
          messageCount: 0,
          history: []
        });
      }

      session.userId = session.userId || userObjectId;
      session.categoryId = session.categoryId || categoryObjectId;
      session.title = session.title || String(question || '').trim().slice(0, 18) || '新的对话';
      session.lastQuestion = String(question || '');
      session.lastAnswer = String(fullAnswer || '');
      session.history = [
        { role: 'user', content: String(question || ''), sources: [] },
        { role: 'assistant', content: String(fullAnswer || '根据当前知识库内容暂时无法确定。'), sources }
      ];
      session.messageCount = session.history.length;
      await session.save();
      console.log('[QA] 对话历史已记录', String(session._id));
    } catch (historyError) {
      console.error('[QA] 记录对话历史失败:', historyError);
    }

    sendSSE(res, 'done', {
      answer: fullAnswer || '根据当前知识库内容暂时无法确定。',
      sessionId: finalSessionId,
      sources,
      recommendedKnowledge,
      suggestedKnowledge: autoSwitched ? routedCategoryName : (suggestedCategory?.name || ''),
      suggestedKnowledgeId: autoSwitched ? routedCategoryId : (suggestedCategory?.id || ''),
      answeredByKnowledgeId: autoSwitched ? routedCategoryId : (categoryId || null),
      answeredByKnowledge: autoSwitched ? routedCategoryName : categoryName
    });
    
    res.end();
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error('[QA][Error]', error);

    try {
      await QALog.create({
        question: req.body.question || '',
        answer: '',
        categoryId: req.body.categoryId || null,
        categoryName: '',
        userId: getRequestUser(req).userId || null,
        sources: [],
        sessionId: req.body.sessionId || '',
        responseTime,
        status: 'failed',
        errorMessage: error.message
      });
    } catch (logError) {
      console.error('[QA] 记录失败日志失败:', logError);
    }

    try {
      sendSSE(res, 'error', { message: error.message });
      res.end();
    } catch {
      res.status(500).json({ code: 500, message: '问答失败', error: error.message });
    }
  }
});

export default router;
