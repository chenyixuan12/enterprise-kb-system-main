import { Router } from 'express';
import User from '../models/User.js';
import KnowledgeDocument from '../models/KnowledgeDocument.js';
import KnowledgeCategory from '../models/knowledgeCategory.js';
import QALog from '../models/QALog.js';
import { requireRole } from '../utils/auth.js';

const router = Router();

router.use(requireRole('admin'));

/**
 * @openapi
 * /api/admin/dashboard:
 *   get:
 *     tags: [Admin]
 *     summary: 管理后台首页统计
 *     description: 返回用户数、文档数、今日提问数等，用于 ECharts 展示。当前无权限校验。
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     userCount: { type: integer }
 *                     adminCount: { type: integer }
 *                     docCount: { type: integer }
 *                     processedCount: { type: integer }
 *                     failedCount: { type: integer }
 *                     categoryCount: { type: integer }
 *                     todayQuestions: { type: integer }
 *                     docStatus: { type: array }
 *                     userRoleStats: { type: array }
 */
// 管理后台首页统计数据接口：用于 ECharts 展示
router.get('/dashboard', async (_req, res) => {
  const [userCount, adminCount, docCount, processedCount, failedCount, categoryCount] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'admin' }),
    KnowledgeDocument.countDocuments(),
    KnowledgeDocument.countDocuments({ status: 'processed' }),
    KnowledgeDocument.countDocuments({ status: 'failed' }),
    KnowledgeCategory.countDocuments()
  ]);

  // 计算今日提问数
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let todayQuestions = 0;
  try {
    todayQuestions = await QALog.countDocuments({
      createdAt: { $gte: today, $lt: tomorrow }
    });
  } catch (error) {
    console.error('[Admin] 统计今日提问失败:', error);
  }

  const userRoleStats = [
    { name: '普通用户', value: Math.max(userCount - adminCount, 0) },
    { name: '管理员', value: adminCount }
  ];

  res.json({
    data: {
      userCount,
      adminCount,
      docCount,
      processedCount,
      failedCount,
      categoryCount,
      todayQuestions,
      docStatus: [
        { name: '已处理', value: processedCount },
        { name: '待处理', value: Math.max(docCount - processedCount - failedCount, 0) },
        { name: '失败', value: failedCount }
      ],
      userRoleStats
    }
  });
});

/**
 * @openapi
 * /api/admin/category-stats:
 *   get:
 *     tags: [Admin]
 *     summary: 知识库文档占比统计
 *     description: 按知识库分组统计文档数量，用于饼状图。当前无权限校验。
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: integer, example: 200 }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name: { type: string }
 *                       value: { type: integer }
 *       500:
 *         description: 服务器错误
 */
// 获取知识库文档占比数据（饼状图）
router.get('/category-stats', async (_req, res) => {
  try {
    // 按知识库分组统计文档数量
    const stats = await KnowledgeCategory.aggregate([
      {
        $lookup: {
          from: 'knowledgedocuments',
          localField: '_id',
          foreignField: 'categoryId',
          as: 'documents'
        }
      },
      {
        $project: {
          name: 1,
          docCount: { $size: '$documents' }
        }
      },
      {
        $sort: { docCount: -1 }
      }
    ]);

    const chartData = stats.map(item => ({
      name: item.name,
      value: item.docCount
    }));

    res.json({
      code: 200,
      data: chartData
    });
  } catch (error) {
    console.error('[Admin] 知识库统计失败:', error);
    res.status(500).json({ code: 500, message: '获取统计数据失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/admin/question-trend:
 *   get:
 *     tags: [Admin]
 *     summary: 提问趋势统计
 *     description: 返回最近 N 天每日提问数量，用于折线图。当前无权限校验。
 *     parameters:
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 7 }
 *         description: 统计天数（含今天）
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: integer, example: 200 }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date: { type: string, example: '2026-07-16' }
 *                       count: { type: integer }
 *       500:
 *         description: 服务器错误
 */
// 获取最近提问趋势数据（折线图）
router.get('/question-trend', async (_req, res) => {
  try {
    // 获取最近N天的数据（包含今天）
    const days = parseInt(_req.query.days) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    // 按日期分组统计提问数量
    const trend = await QALog.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // 填充缺失的日期
    const result = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      const found = trend.find(item => item._id === dateStr);
      result.push({
        date: dateStr,
        count: found ? found.count : 0
      });
    }

    res.json({
      code: 200,
      data: result
    });
  } catch (error) {
    console.error('[Admin] 提问趋势统计失败:', error);
    res.status(500).json({ code: 500, message: '获取趋势数据失败', error: error.message });
  }
});

export default router;
