import { Router } from 'express';
import authRouter from './auth.js';
import userRouter from './user.js';
import knowledgeRouter from './knowledge.js';
import qaRouter from './qa.js';
import chatRouter from './chat.js';
import adminRouter from './admin.js';
import { verifyToken } from '../utils/auth.js';

const router = Router();

// 登录与密码提示接口保持公开
router.use('/auth', authRouter);

// 其余所有 /api 接口统一要求携带有效 JWT，未登录返回 401
router.use(verifyToken);

router.use('/users', userRouter);
router.use('/knowledge', knowledgeRouter);
router.use('/qa', qaRouter);
router.use('/chat', chatRouter);
router.use('/admin', adminRouter);

export default router;
