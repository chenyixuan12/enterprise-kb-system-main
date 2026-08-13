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

const router = express.Router();

// 新增分类
router.post('/', createCategory);
// 获取分类列表（支持筛选、分页）
router.get('/', getCategoryList);
// 获取单个分类详情
router.get('/:id', getCategoryDetail);
// 更新分类
router.put('/:id', updateCategory);
// 删除分类（带级联处理）
router.delete('/:id', deleteCategory);
// 切换分类状态
router.put('/:id/status', toggleCategoryStatus);

export default router;