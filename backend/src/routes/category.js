// routes/category.routes.js
import express from 'express';
import {
  createCategory,
  getCategoryList,
  getCategoryDetail,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus
} from '../controllers/category.js';
import { requireRole, verifyToken } from '../utils/auth.js';

const router = express.Router();

// 该路由挂在 app 层（非 /api 聚合路由），需自行保证登录态
router.use(verifyToken);

// 写操作仅管理员可用；查询接口已登录即可
router.post('/', requireRole('admin'), createCategory);
// 获取分类列表（支持筛选、分页）
router.get('/', getCategoryList);
// 获取单个分类详情
router.get('/:id', getCategoryDetail);
// 更新分类
router.put('/:id', requireRole('admin'), updateCategory);
// 删除分类（带级联处理）
router.delete('/:id', requireRole('admin'), deleteCategory);
// 切换分类状态
router.put('/:id/status', requireRole('admin'), toggleCategoryStatus);

export default router;