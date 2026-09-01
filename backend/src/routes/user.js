import { Router } from 'express';
import User from '../models/User.js';
import { config } from '../config/env.js';
import { requireRole } from '../utils/auth.js';

const router = Router();

function normalizeStatus(status) {
  return status === 'disabled' ? 'disabled' : 'active';
}

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'user';
}

function buildUserResponse(user) {
  if (!user) return null;
  const obj = user.toObject ? user.toObject() : user;
  return {
    ...obj,
    _id: String(obj._id),
    password: undefined
  };
}

/**
 * @openapi
 * /api/users:
 *   get:
 *     tags: [Users]
 *     summary: 获取用户列表
 *     description: 仅管理员可访问，支持 keyword、role、status 筛选
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     parameters:
 *       - in: query
 *         name: keyword
 *         schema: { type: string }
 *         description: 按用户名或昵称模糊搜索
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [admin, user] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, disabled] }
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *       403:
 *         description: 无权限
 *       500:
 *         description: 服务器错误
 */
// 用户列表接口：仅管理员可查看全部用户
router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const { keyword = '', role = '', status = '' } = req.query;
    const filter = {};

    if (role) filter.role = normalizeRole(role);
    if (status) filter.status = normalizeStatus(status);
    if (keyword) {
      const regex = new RegExp(keyword, 'i');
      filter.$or = [{ username: regex }, { nickname: regex }];
    }

    const users = await User.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ data: users.map((item) => ({ ...item, _id: String(item._id), password: undefined })) });
  } catch (error) {
    res.status(500).json({ message: '获取用户列表失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: 获取用户详情
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 成功
 *       403:
 *         description: 无权限
 *       404:
 *         description: 用户不存在
 *       500:
 *         description: 服务器错误
 */
// 获取用户详情：仅管理员可查看
router.get('/:id', requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).lean();
    if (!user) return res.status(404).json({ message: '用户不存在' });
    res.json({ data: { ...user, _id: String(user._id), password: undefined } });
  } catch (error) {
    res.status(500).json({ message: '获取用户详情失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/users:
 *   post:
 *     tags: [Users]
 *     summary: 新增用户
 *     description: 仅管理员可操作，默认密码为 123456
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               username: { type: string }
 *               password: { type: string, default: '123456' }
 *               role: { type: string, enum: [admin, user], default: user }
 *               nickname: { type: string }
 *               status: { type: string, enum: [active, disabled], default: active }
 *     responses:
 *       201:
 *         description: 创建成功
 *       400:
 *         description: 参数错误或用户名已存在
 *       403:
 *         description: 无权限
 *       500:
 *         description: 服务器错误
 */
// 新增用户：默认密码取环境变量 DEFAULT_USER_PASSWORD
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { username, password = config.defaultUserPassword, role = 'user', nickname = '', status = 'active' } = req.body || {};

    if (!username?.trim()) {
      return res.status(400).json({ message: '用户名不能为空' });
    }

    const exists = await User.findOne({ username: username.trim() }).lean();
    if (exists) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    const user = await User.create({
      username: username.trim(),
      password,
      role: normalizeRole(role),
      nickname: nickname.trim(),
      status: normalizeStatus(status)
    });

    res.status(201).json({ message: '创建成功', data: buildUserResponse(user) });
  } catch (error) {
    res.status(500).json({ message: '创建失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/users/{id}:
 *   put:
 *     tags: [Users]
 *     summary: 更新用户
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
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
 *               username: { type: string }
 *               password: { type: string }
 *               role: { type: string, enum: [admin, user] }
 *               nickname: { type: string }
 *               status: { type: string, enum: [active, disabled] }
 *     responses:
 *       200:
 *         description: 更新成功
 *       400:
 *         description: 参数错误
 *       403:
 *         description: 无权限
 *       404:
 *         description: 用户不存在
 *       500:
 *         description: 服务器错误
 */
// 更新用户：仅管理员可修改
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { username, password, role, nickname, status } = req.body || {};
    const update = {};

    if (username !== undefined) {
      if (!String(username).trim()) {
        return res.status(400).json({ message: '用户名不能为空' });
      }
      const duplicate = await User.findOne({ username: String(username).trim(), _id: { $ne: req.params.id } }).lean();
      if (duplicate) {
        return res.status(400).json({ message: '用户名已存在' });
      }
      update.username = String(username).trim();
    }

    if (password !== undefined && String(password).trim()) {
      update.password = await User.hashPassword(String(password).trim());
    }

    if (role !== undefined) update.role = normalizeRole(role);
    if (nickname !== undefined) update.nickname = String(nickname).trim();
    if (status !== undefined) update.status = normalizeStatus(status);

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ message: '用户不存在' });

    res.json({ message: '更新成功', data: buildUserResponse(user) });
  } catch (error) {
    res.status(500).json({ message: '更新失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: 删除用户
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 删除成功
 *       403:
 *         description: 无权限
 *       404:
 *         description: 用户不存在
 *       500:
 *         description: 服务器错误
 */
// 删除用户：仅管理员可删除
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: '用户不存在' });
    res.json({ message: '删除成功', data: buildUserResponse(user) });
  } catch (error) {
    res.status(500).json({ message: '删除失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/users/{id}/reset-password:
 *   patch:
 *     tags: [Users]
 *     summary: 重置用户密码
 *     description: 仅管理员可操作，重置为默认密码 123456
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 密码重置成功
 *       403:
 *         description: 无权限
 *       404:
 *         description: 用户不存在
 *       500:
 *         description: 服务器错误
 */
// 重置密码：仅管理员可操作，重置为环境变量 DEFAULT_USER_PASSWORD 指定的密码
router.patch('/:id/reset-password', requireRole('admin'), async (req, res) => {
  try {
    const hashedPassword = await User.hashPassword(config.defaultUserPassword);
    const user = await User.findByIdAndUpdate(req.params.id, { password: hashedPassword }, { new: true });
    if (!user) return res.status(404).json({ message: '用户不存在' });
    res.json({ message: '密码重置成功', data: buildUserResponse(user) });
  } catch (error) {
    res.status(500).json({ message: '密码重置失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/users/{id}/status:
 *   patch:
 *     tags: [Users]
 *     summary: 切换用户状态
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
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
 *               status: { type: string, enum: [active, disabled] }
 *     responses:
 *       200:
 *         description: 状态更新成功
 *       403:
 *         description: 无权限
 *       404:
 *         description: 用户不存在
 *       500:
 *         description: 服务器错误
 */
// 切换用户状态：active / disabled
router.patch('/:id/status', requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.body || {};
    const normalizedStatus = normalizeStatus(status);
    const user = await User.findByIdAndUpdate(req.params.id, { status: normalizedStatus }, { new: true });
    if (!user) return res.status(404).json({ message: '用户不存在' });
    res.json({ message: '状态更新成功', data: buildUserResponse(user) });
  } catch (error) {
    res.status(500).json({ message: '状态更新失败', error: error.message });
  }
});

export default router;
