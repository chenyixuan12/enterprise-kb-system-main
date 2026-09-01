import { Router } from 'express';
import mongoose from 'mongoose';
import ChatSession from '../models/ChatSession.js';
import { requireRole, getRequestUser, isAdmin } from '../utils/auth.js';

const router = Router();

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

function canAccessSession(req, session) {
  if (isAdmin(req)) return true;
  const currentUser = getRequestUser(req);
  return Boolean(session?.userId && currentUser.userId && String(session.userId) === String(currentUser.userId));
}

function summarizeTitle(question = '') {
  const text = String(question).trim();
  if (!text) return '新的对话';
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
}

/**
 * @openapi
 * /api/chat/admin/all:
 *   get:
 *     tags: [Chat]
 *     summary: 管理员查看所有会话
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     responses:
 *       200:
 *         description: 成功
 *       403:
 *         description: 无权限
 *       500:
 *         description: 服务器错误
 */
// 管理员查看所有会话
router.get('/admin/all', requireRole('admin'), async (_req, res) => {
  try {
    const sessions = await ChatSession.find().sort({ updatedAt: -1 }).lean();
    res.json({ data: sessions });
  } catch (error) {
    res.status(500).json({ message: '获取会话失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/chat:
 *   get:
 *     tags: [Chat]
 *     summary: 获取当前用户会话列表
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     parameters:
 *       - in: query
 *         name: categoryId
 *         schema: { type: string }
 *         description: 按知识库分类筛选
 *     responses:
 *       200:
 *         description: 成功
 *       500:
 *         description: 服务器错误
 */
// 会话列表
router.get('/', async (req, res) => {
  try {
    const currentUser = getRequestUser(req);
    const userId = currentUser.userId ? toObjectId(currentUser.userId) : null;
    const { categoryId } = req.query;
    const filter = {};
    if (userId) filter.userId = userId;
    if (categoryId) filter.categoryId = toObjectId(categoryId);

    const sessions = await ChatSession.find(filter).sort({ updatedAt: -1 }).lean();
    res.json({ data: sessions });
  } catch (error) {
    res.status(500).json({ message: '获取会话列表失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/chat/{id}:
 *   get:
 *     tags: [Chat]
 *     summary: 获取会话详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 成功
 *       404:
 *         description: 会话不存在
 *       500:
 *         description: 服务器错误
 */
// 会话详情：仅会话所有者或管理员可查看
router.get('/:id', async (req, res) => {
  try {
    const session = await ChatSession.findById(req.params.id).lean();
    if (!session) return res.status(404).json({ message: '会话不存在' });
    if (!canAccessSession(req, session)) {
      return res.status(403).json({ message: '无权限访问该会话' });
    }
    res.json({ data: session });
  } catch (error) {
    res.status(500).json({ message: '获取会话详情失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/chat/{id}:
 *   delete:
 *     tags: [Chat]
 *     summary: 删除会话
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 删除成功
 *       404:
 *         description: 会话不存在
 *       500:
 *         description: 服务器错误
 */
// 删除会话：仅会话所有者或管理员可删除
router.delete('/:id', async (req, res) => {
  try {
    const session = await ChatSession.findById(req.params.id).lean();
    if (!session) return res.status(404).json({ message: '会话不存在' });
    if (!canAccessSession(req, session)) {
      return res.status(403).json({ message: '无权限删除该会话' });
    }
    await ChatSession.findByIdAndDelete(req.params.id);
    res.json({ message: '删除成功', data: session });
  } catch (error) {
    res.status(500).json({ message: '删除失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/chat/save:
 *   post:
 *     tags: [Chat]
 *     summary: 手动保存会话
 *     description: 兼容手动存储会话，QA 流式完成后也可调用
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sessionId: { type: string }
 *               categoryId: { type: string }
 *               question: { type: string }
 *               answer: { type: string }
 *               sources: { type: array, items: { type: object } }
 *               history: { type: array, items: { type: object } }
 *     responses:
 *       201:
 *         description: 会话保存成功
 *       500:
 *         description: 服务器错误
 */
// 兼容手动存储会话（QA流式完成后调用）
router.post('/save', async (req, res) => {
  try {
    const currentUser = getRequestUser(req);
    const { sessionId, categoryId, question, answer, sources = [], history = [] } = req.body || {};
    const userId = currentUser.userId ? toObjectId(currentUser.userId) : null;
    const normalizedCategoryId = toObjectId(categoryId);
    const finalHistory = Array.isArray(history) ? history : [];

    let session;
    if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
      session = await ChatSession.findById(sessionId);
      if (session && !canAccessSession(req, session)) {
        return res.status(403).json({ message: '无权限修改该会话' });
      }
    }

    if (!session) {
      session = new ChatSession({
        userId,
        categoryId: normalizedCategoryId,
        title: summarizeTitle(question),
        lastQuestion: String(question || ''),
        lastAnswer: String(answer || ''),
        messageCount: 0,
        history: []
      });
    }

    if (question) {
      session.lastQuestion = String(question);
      session.title = session.title || summarizeTitle(question);
      session.history.push({ role: 'user', content: String(question), sources: [] });
    }
    if (answer) {
      session.lastAnswer = String(answer);
      session.history.push({ role: 'assistant', content: String(answer), sources: Array.isArray(sources) ? sources : [] });
    }

    if (finalHistory.length) {
      session.history = finalHistory;
    }

    session.userId = session.userId || userId;
    session.categoryId = session.categoryId || normalizedCategoryId;
    session.messageCount = session.history.length;
    await session.save();

    res.status(201).json({
      message: '会话保存成功',
      data: session.toObject()
    });
  } catch (error) {
    res.status(500).json({ message: '会话保存失败', error: error.message });
  }
});

export default router;
