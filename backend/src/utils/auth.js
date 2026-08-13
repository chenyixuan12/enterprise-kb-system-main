// 鉴权工具：根据用户角色进行接口权限控制
export function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.headers['x-user-role'];
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ message: '无权限访问该接口' });
    }
    next();
  };
}

// 从请求头中读取用户身份信息，简化入门版项目的登录态管理
export function getRequestUser(req) {
  return {
    userId: req.headers['x-user-id'] || '',
    username: req.headers['x-user-name'] || '',
    role: req.headers['x-user-role'] || 'user'
  };
}

// 检查当前登录用户是否为管理员
export function isAdmin(req) {
  return req.headers['x-user-role'] === 'admin';
}
