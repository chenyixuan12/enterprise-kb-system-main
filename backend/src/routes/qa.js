import { Router } from 'express';
import path from 'path';
import mongoose from 'mongoose';
import KnowledgeDocument from '../models/KnowledgeDocument.js';
import KnowledgeCategory from '../models/knowledgeCategory.js';
import ChatSession from '../models/ChatSession.js';
import QALog from '../models/QALog.js';
import { generateAnswer, generateAnswerStream, embedQuery } from '../services/ollamaService.js';
import { extractTextFromFile } from '../services/documentService.js';
import { queryChunks } from '../services/chromaService.js';

const router = Router();
const MAX_RECALL_DOCS = 5;
const MAX_RECALL_CHUNKS = 5;
const MAX_SOURCE_DOCS = 3;
const MAX_CONTEXT_CHARS = 6000;
const SOURCE_SCORE_THRESHOLD = 0.2;
const LOW_MATCH_THRESHOLD = 4;
const LOW_MATCH_MESSAGE = '建议切换到更匹配的知识库后再提问。';
const LOCATION_QUERY_TERMS = ['在哪里', '在哪', '哪里', '怎么去', '怎么走', '位置', '地址', '几楼', '在哪一层', '餐厅', '食堂', '停车场', '会议室', '健身房', '休息区', '洗手间', '卫生间'];
const GUIDE_DOC_TERMS = ['指南', '手册', '说明', '使用说明', '使用指南', '入职', '导览', '流程', '介绍'];

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

  const locationQuery = keywords.some((kw) => LOCATION_QUERY_TERMS.some((term) => kw.includes(term) || term.includes(kw)));
  if (locationQuery) {
    if (GUIDE_DOC_TERMS.some((term) => title.includes(term) || originalName.includes(term) || content.slice(0, 1200).includes(term))) {
      score += 8;
    }
    if (content.includes('餐厅') || content.includes('食堂') || content.includes('会议室') || content.includes('停车场') || content.includes('位置')) {
      score += 6;
    }
  }

  return score;
}

async function loadDocumentContent(doc) {
  if (doc.content && String(doc.content).trim()) {
    return String(doc.content);
  }

  if (!doc.localPath) return '';

  const filePath = path.resolve(doc.localPath);
  try {
    const ext = String(doc.fileType || '').toLowerCase();
    const content = await extractTextFromFile(filePath, ext);
    return String(content || '');
  } catch (error) {
    console.error('[QA] 按需读取文件失败', { documentId: String(doc._id), localPath: doc.localPath, fileType: doc.fileType, error: error?.message || error });
    return '';
  }
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

function calculateKeywordBoost(question) {
  const normalized = normalizeText(question);
  const locationQuery = LOCATION_QUERY_TERMS.some((term) => normalized.includes(term));
  const guideQuery = GUIDE_DOC_TERMS.some((term) => normalized.includes(term));
  return {
    locationQuery,
    guideQuery,
    bonus: (locationQuery ? 2 : 0) + (guideQuery ? 1 : 0)
  };
}

async function buildHybridCandidates(question, docsById) {
  const keywords = extractKeywords(question);
  const docs = [...docsById.values()];
  const vectorScoreMap = new Map();

  try {
    const questionEmbedding = await embedQuery(question.trim());
    const vectorHits = await queryChunks(questionEmbedding, { topK: MAX_RECALL_DOCS * 4 });
    for (const hit of vectorHits) {
      const documentId = String(hit.metadata?.documentId || '');
      if (!documentId) continue;
      const previousScore = vectorScoreMap.get(documentId) || 0;
      vectorScoreMap.set(documentId, Math.max(previousScore, Number(hit.score || 0)));
    }
  } catch (error) {
    console.error('[QA] 全局向量召回失败，退回关键词推荐', error?.message || error);
  }

  const queryBoost = calculateKeywordBoost(question);

  return {
    hybrid: docs.map((doc) => {
      const keywordScore = scoreDocument(doc, keywords, null);
      const vectorScore = vectorScoreMap.get(String(doc._id)) || 0;
      const titleText = normalizeText(doc.title);
      const nameText = normalizeText(doc.originalName);
      const contentText = normalizeText(doc.content || '');
      const relevanceBonus = queryBoost.locationQuery && (titleText.includes('指南') || nameText.includes('指南') || contentText.includes('位置') || contentText.includes('餐厅') || contentText.includes('食堂')) ? 3 : 0;
      const hybridScore = keywordScore + vectorScore * 40 + queryBoost.bonus + relevanceBonus;

      return {
        doc,
        keywordScore,
        vectorScore,
        hybridScore,
        content: String(doc.content || '')
      };
    }),
    chromaHits: [...vectorScoreMap.entries()].map(([documentId, score]) => ({ documentId, score }))
  };
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
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
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
    const docsById = new Map(allDocs.map((doc) => [String(doc._id), doc]));
    
    // 根据是否选择了知识库过滤文档
    const query = {};
    if (categoryId) {
      query.categoryId = categoryId;
    }
    const docs = categoryId 
      ? allDocs.filter(doc => String(doc.categoryId || '') === String(categoryId))
      : allDocs;
    
    console.log('[QA] 候选文档数量', docs.length);

    const categories = await KnowledgeCategory.find({}, { _id: 1, name: 1 }).lean();
    const categoriesById = new Map(categories.map((item) => [String(item._id), item.name]));

    const { hybrid: allHybridDocs } = await buildHybridCandidates(question.trim(), docsById);
    const recommendedKnowledge = buildRecommendedKnowledge(allHybridDocs, categoriesById);
    const suggestedCategory = recommendedKnowledge[0] || null;

    const { hybrid: hybridDocs } = await buildHybridCandidates(question.trim(), docsById);
    const bestHybridScore = hybridDocs.length ? Math.max(...hybridDocs.map((item) => item.hybridScore)) : 0;
    const bestHybridDoc = hybridDocs.slice().sort((a, b) => b.hybridScore - a.hybridScore)[0] || null;
    const currentCategoryScore = categoryId
      ? hybridDocs.filter((item) => String(item.doc.categoryId || '') === String(categoryId)).reduce((max, item) => Math.max(max, item.hybridScore), 0)
      : 0;
    const suggestedCategoryScore = suggestedCategory?.score || 0;
    const hasGoodMatch = bestHybridScore >= LOW_MATCH_THRESHOLD && bestHybridScore > 0;
    const currentBestMatchTitle = bestHybridDoc?.doc?.title || '';
    const topRecommended = recommendedKnowledge[0] || null;
    const currentCategory = categoryId ? categoriesById.get(String(categoryId)) : '';
    const currentCategoryIsTop = topRecommended && categoryId && String(categoryId) === String(topRecommended.id);
    const scoreGap = suggestedCategoryScore - currentCategoryScore;
    const shouldRecommendSwitch = topRecommended
      && (!currentCategoryIsTop || currentCategoryScore < LOW_MATCH_THRESHOLD)
      && (scoreGap >= 1.5 || currentCategoryScore < LOW_MATCH_THRESHOLD);

    if ((!hasGoodMatch || shouldRecommendSwitch) && topRecommended && (!currentCategoryIsTop || scoreGap > 0.8)) {
      const recommendationText = currentCategory
        ? `你当前选择的是「${currentCategory}」，但这个问题和当前知识库相关性较低。`
        : '当前选择的知识库与问题相关性较低。';
      const shouldForceSwitch = !currentCategoryIsTop || scoreGap >= 1.5;

      sendSSE(res, 'mismatch', {
        message: `${recommendationText} ${LOW_MATCH_MESSAGE}`,
        suggestedKnowledge: topRecommended.name,
        suggestedKnowledgeId: topRecommended.id,
        recommendedKnowledge,
        currentCategoryScore,
        suggestedCategoryScore,
        currentCategoryName: currentCategory || '',
        topMatchedDocument: currentBestMatchTitle,
        isHighlyRelevant: false,
        scoreGap: Number(scoreGap.toFixed(2)),
        shouldForceSwitch
      });
    }

    console.log('[QA] 混合召回结果', hybridDocs.map((item) => ({ id: String(item.doc._id), title: item.doc.title, keywordScore: item.keywordScore, vectorScore: item.vectorScore, hybridScore: item.hybridScore })));

    const ranked = hybridDocs
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, MAX_RECALL_DOCS)
      .map((item) => item.doc);

    console.log('[QA] 排名前', ranked.map((doc) => ({ id: String(doc._id), title: doc.title, localPath: doc.localPath }))); 

    const docsWithContent = [];
    for (const doc of ranked) {
      const content = await loadDocumentContent(doc);
      console.log('[QA] 读取文件结果', {
        documentId: String(doc._id),
        title: doc.title,
        contentLength: content.length
      });
      if (content.trim()) {
        docsWithContent.push({
          doc,
          content,
          score: hybridDocs.find((item) => String(item.doc._id) === String(doc._id))?.hybridScore || 0
        });
      }
    }

    const keywordContext = buildContext(docsWithContent);
    console.log('[QA] 关键词召回上下文长度', keywordContext.length);

    let retrievedChunks = [];
    try {
      const questionEmbedding = await embedQuery(question.trim());
      retrievedChunks = await queryChunks(questionEmbedding, {
        categoryId: categoryId || undefined,
        topK: MAX_RECALL_CHUNKS
      });
      console.log('[QA] Chroma Chunk 召回结果', retrievedChunks.map((chunk) => ({
        chunkId: chunk.id,
        title: chunk.metadata?.title,
        score: chunk.score
      })));
    } catch (retrievalError) {
      console.error('[QA] Chroma 检索失败，回退到关键词检索', retrievalError.message);
    }

    const context = retrievedChunks.length > 0 ? buildContext(retrievedChunks) : keywordContext;
    console.log('[QA] 最终上下文长度', context.length);

    const sources = retrievedChunks.length > 0
      ? pickTopSources(retrievedChunks, MAX_SOURCE_DOCS)
      : pickTopSources(docsWithContent, MAX_SOURCE_DOCS);
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

    const responseTime = Date.now() - startTime;
    try {
      await QALog.create({
        question: question.trim(),
        answer: fullAnswer || '根据当前知识库内容暂时无法确定。',
        categoryId: categoryId || null,
        categoryName,
        userId: req.headers['x-user-id'] || null,
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
      const userObjectId = req.headers['x-user-id'] && mongoose.Types.ObjectId.isValid(req.headers['x-user-id'])
        ? new mongoose.Types.ObjectId(req.headers['x-user-id'])
        : null;
      const categoryObjectId = categoryId && mongoose.Types.ObjectId.isValid(categoryId)
        ? new mongoose.Types.ObjectId(categoryId)
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
      suggestedKnowledge: suggestedCategory?.name || '',
      suggestedKnowledgeId: suggestedCategory?.id || ''
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
        userId: req.headers['x-user-id'] || null,
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
