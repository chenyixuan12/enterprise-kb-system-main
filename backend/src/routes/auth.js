import { Router } from 'express';
import User from '../models/User.js';
import { signToken, decodeToken } from '../utils/auth.js';

const router = Router();

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: 用户登录
 *     description: 校验用户名密码，返回用户基础信息、JWT access token 与 refresh token。前端后续在 Authorization 请求头中携带 Bearer access token。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: 登录成功
 *       401:
 *         description: 用户名或密码错误
 *       500:
 *         description: 服务器错误
 */
// 登录接口：校验通过后签发 JWT access token 与 refresh token
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username, status: 'active' });
    if (!user) return res.status(401).json({ message: '用户名或密码错误' });

    const isMatch = await User.comparePassword(password, user.password);
    if (!isMatch) return res.status(401).json({ message: '用户名或密码错误' });

    const accessToken = signToken(user, { expiresIn: '30m' });
    const refreshToken = signToken(user, { expiresIn: '14d' });

    res.json({
      message: '登录成功',
      data: {
        _id: String(user._id),
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        tokenVersion: Number(user.tokenVersion || 0),
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    res.status(500).json({ message: '登录失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: 刷新访问令牌
 *     description: 使用 refresh token 换取新的 access token（并同步刷新 refresh token）。
 *     responses:
 *       200:
 *         description: 刷新成功
 *       401:
 *         description: 刷新令牌无效或已过期
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(401).json({ message: '缺少 refreshToken' });
    }

    const payload = decodeToken(refreshToken);
    const user = await User.findById(payload.userId);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ message: '账号不可用，请重新登录' });
    }

    if (Number(payload.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
      return res.status(401).json({ message: '登录状态已失效，请重新登录' });
    }

    const accessToken = signToken(user, { expiresIn: '30m' });
    const nextRefreshToken = signToken(user, { expiresIn: '14d' });

    res.json({
      message: '刷新成功',
      data: {
        accessToken,
        refreshToken: nextRefreshToken,
        tokenVersion: Number(user.tokenVersion || 0)
      }
    });
  } catch (error) {
    res.status(401).json({ message: '刷新令牌无效或已过期', error: error.message });
  }
});

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: 退出登录
 *     description: 通过提升 tokenVersion 让当前用户所有已签发 token 失效。
 *     responses:
 *       200:
 *         description: 退出成功
 */
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (refreshToken) {
      try {
        const payload = decodeToken(refreshToken);
        await User.findByIdAndUpdate(payload.userId, { $inc: { tokenVersion: 1 } });
      } catch {
        // refreshToken 无效时也允许客户端完成本地退出
      }
    }

    res.json({ message: '退出成功' });
  } catch (error) {
    res.status(500).json({ message: '退出失败', error: error.message });
  }
});

export default router;
