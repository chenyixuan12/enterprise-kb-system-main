import { Router } from 'express';
import User from '../models/User.js';

const router = Router();

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: 用户登录
 *     description: 校验用户名密码，返回用户基础信息。前端登录后将信息存入 localStorage，后续请求通过 x-user-* 请求头携带身份。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: 登录成功
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: 用户名或密码错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: 服务器错误
 */
// 登录接口：返回用户基础信息，前端后续通过请求头携带身份信息
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username, status: 'active' });
    if (!user) return res.status(401).json({ message: '用户名或密码错误' });

    const isMatch = await User.comparePassword(password, user.password);
    if (!isMatch) return res.status(401).json({ message: '用户名或密码错误' });

    res.json({
      message: '登录成功',
      data: {
        _id: String(user._id),
        username: user.username,
        nickname: user.nickname,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: '登录失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/auth/password-tip:
 *   get:
 *     tags: [Auth]
 *     summary: 获取默认测试密码提示
 *     description: 教学演示用，返回统一默认密码说明
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: 默认测试密码统一为 123456
 */
// 当前项目为教学示例，直接返回默认测试密码说明
router.get('/password-tip', (_req, res) => {
  res.json({ message: '默认测试密码统一为 123456' });
});

export default router;
