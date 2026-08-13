// controllers/category.controller.js
import KnowledgeCategory from '../models/knowledgeCategory.js';
import KnowledgeDocument from '../models/KnowledgeDocument.js'; // 文档模型，删除分类时级联用

/**
 * @openapi
 * /api/category:
 *   post:
 *     tags: [Category]
 *     summary: 新增知识库分类
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: 创建成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: integer }
 *                 msg: { type: string }
 *                 data:
 *                   $ref: '#/components/schemas/Category'
 */
// 1. 新增知识库分类
export const createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.json({ code: 400, msg: '知识库名称不能为空' });
    }

    const existCategory = await KnowledgeCategory.findOne({ name });
    if (existCategory) {
      return res.json({ code: 400, msg: '该知识库名称已存在' });
    }

    const newCategory = await KnowledgeCategory.create({
      name,
      description,
      status: 'active'
    });
    res.json({ code: 200, msg: '创建成功', data: newCategory });
  } catch (err) {
    console.error('新增分类失败：', err);
    res.json({ code: 500, msg: '服务器错误，请稍后重试' });
  }
};

/**
 * @openapi
 * /api/category:
 *   get:
 *     tags: [Category]
 *     summary: 获取知识库分类列表
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: title
 *         schema: { type: string }
 *         description: 按名称搜索（title 或 name 均可）
 *       - in: query
 *         name: name
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 获取成功，含分页和 docCount
 */
// 2. 获取知识库分类列表（支持状态筛选+分页+名称搜索）
export const getCategoryList = async (req, res) => {
  try {
    const { status, page = 1, pageSize = 10, title, name } = req.query;
    const filter = {};
    if (status) filter.status = status;
    
    // 支持按名称搜索（title和name都支持）
    const searchKeyword = title || name;
    if (searchKeyword) {
      filter.name = { $regex: searchKeyword, $options: 'i' };
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const categoryList = await KnowledgeCategory.find(filter)
      .skip(skip)
      .limit(Number(pageSize))
      .sort({ createTime: -1 });
    const total = await KnowledgeCategory.countDocuments(filter);

    // 统计每个知识库的文档数量
    const countMap = {};
    for (const cat of categoryList) {
      const count = await KnowledgeDocument.countDocuments({ categoryId: cat._id });
      countMap[cat._id.toString()] = count;
    }
    
    const listWithCount = categoryList.map(cat => ({
      ...cat.toObject(),
      docCount: countMap[cat._id.toString()] || 0
    }));

    res.json({
      code: 200,
      msg: '获取成功',
      data: {
        list: listWithCount,
        total,
        page: Number(page),
        pageSize: Number(pageSize)
      }
    });
  } catch (err) {
    console.error('获取分类列表失败：', err);
    res.json({ code: 500, msg: '服务器错误，请稍后重试' });
  }
};

/**
 * @openapi
 * /api/category/{id}:
 *   get:
 *     tags: [Category]
 *     summary: 获取分类详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 获取成功
 *       404:
 *         description: 知识库不存在
 */
// 3. 获取单个分类详情
export const getCategoryDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await KnowledgeCategory.findById(id);
    if (!category) {
      return res.json({ code: 404, msg: '该知识库不存在' });
    }
    res.json({ code: 200, msg: '获取成功', data: category });
  } catch (err) {
    console.error('获取分类详情失败：', err);
    res.json({ code: 500, msg: '服务器错误，请稍后重试' });
  }
};

/**
 * @openapi
 * /api/category/{id}:
 *   put:
 *     tags: [Category]
 *     summary: 更新知识库分类
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               status: { type: string, enum: [active, inactive] }
 *     responses:
 *       200:
 *         description: 更新成功
 *       404:
 *         description: 知识库不存在
 */
// 4. 更新知识库分类
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, status } = req.body;

    const existCategory = await KnowledgeCategory.findById(id);
    if (!existCategory) {
      return res.json({ code: 404, msg: '该知识库不存在' });
    }

    if (name && name !== existCategory.name) {
      const duplicateName = await KnowledgeCategory.findOne({ name });
      if (duplicateName) {
        return res.json({ code: 400, msg: '该知识库名称已存在' });
      }
    }

    const updatedCategory = await KnowledgeCategory.findByIdAndUpdate(
      id,
      { name, description, status },
      { new: true }
    );
    res.json({ code: 200, msg: '更新成功', data: updatedCategory });
  } catch (err) {
    console.error('更新分类失败：', err);
    res.json({ code: 500, msg: '服务器错误，请稍后重试' });
  }
};

/**
 * @openapi
 * /api/category/{id}:
 *   delete:
 *     tags: [Category]
 *     summary: 删除知识库分类
 *     description: 删除分类并将关联文档的 categoryId 设为 null
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 删除成功
 *       404:
 *         description: 知识库不存在
 */
// 5. 删除知识库分类（带级联处理：把关联文档的categoryId设为null）
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const existCategory = await KnowledgeCategory.findById(id);
    if (!existCategory) {
      return res.json({ code: 404, msg: '该知识库不存在' });
    }

    await KnowledgeCategory.findByIdAndDelete(id);
    await KnowledgeDocument.updateMany(
      { categoryId: id },
      { $set: { categoryId: null } }
    );

    res.json({ code: 200, msg: '删除成功' });
  } catch (err) {
    console.error('删除分类失败：', err);
    res.json({ code: 500, msg: '服务器错误，请稍后重试' });
  }
};

/**
 * @openapi
 * /api/category/{id}/status:
 *   put:
 *     tags: [Category]
 *     summary: 切换分类状态
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [active, inactive] }
 *     responses:
 *       200:
 *         description: 状态更新成功
 *       400:
 *         description: 状态参数错误
 *       404:
 *         description: 知识库不存在
 */
// 6. 单独切换分类状态（active/inactive）
export const toggleCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.json({ code: 400, msg: '状态参数错误' });
    }

    const updatedCategory = await KnowledgeCategory.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );
    if (!updatedCategory) {
      return res.json({ code: 404, msg: '该知识库不存在' });
    }
    res.json({ code: 200, msg: '状态更新成功', data: updatedCategory });
  } catch (err) {
    console.error('切换状态失败：', err);
    res.json({ code: 500, msg: '服务器错误，请稍后重试' });
  }
};
