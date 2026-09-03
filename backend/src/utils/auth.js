import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

// JWT 鉴权工具：登录后签发签名 Token，接口通过 Bearer Token 验证身份。
// 不再信任客户端传入的 x-user-* 请求头。

function getJwtSecret() {
  if (!config.jwtSecret) {
    throw new Error('未配置 JWT_SECRET，请在后端 .env 中设置一个足够长的随机字符串');
  }
  return config.jwtSecret;
}

// 登录成功后签发 Token，payload 中携带用户基础信息
export function signToken(user, options = {}) {
  return jwt.sign(
    {
      userId: String(user._id),
      username: user.username,
      role: user.role,
      tokenVersion: Number(user.tokenVersion || 0)
    },
    getJwtSecret(),
    { expiresIn: options.expiresIn || config.jwtExpiresIn }
  );
}

function verifyJwtToken(token) {
  return jwt.verify(token, getJwtSecret());
}

export function decodeToken(token) {
  return verifyJwtToken(token);
}

// 全局鉴权中间件：校验 Authorization: Bearer <token>，将用户身份挂载到 req.user
export async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!token) {
      return res.status(401).json({ message: '未登录或登录已过期，请重新登录' });
    }

    const payload = verifyJwtToken(token);
    req.user = {
      userId: String(payload.userId || ''),
      username: String(payload.username || ''),
      role: String(payload.role || 'user'),
      tokenVersion: Number(payload.tokenVersion || 0)
    };
    req.authToken = token;

    const { default: User } = await import('../models/User.js');
    const currentUser = await User.findById(req.user.userId).lean();
    if (!currentUser || currentUser.status !== 'active') {
      return res.status(401).json({ message: '账号不可用，请重新登录' });
    }
    if (Number(currentUser.tokenVersion || 0) !== Number(req.user.tokenVersion || 0)) {
      return res.status(401).json({ message: '登录状态已失效，请重新登录' });
    }

    next();
  } catch {
    return res.status(401).json({ message: '登录已过期或凭证无效，请重新登录' });
  }
}

// 角色权限中间件：需在 verifyToken 之后使用
export function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ message: '无权限访问该接口' });
    }
    next();
  };
}

// 从已校验的 Token 中读取用户身份信息
export function getRequestUser(req) {
  return (
    req.user || {
      userId: '',
      username: '',
      role: 'user'
    }
  );
}

// 检查当前登录用户是否为管理员
export function isAdmin(req) {
  return req.user?.role === 'admin';
}
