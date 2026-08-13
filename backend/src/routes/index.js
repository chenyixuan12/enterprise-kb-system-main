import { Router } from 'express';
import authRouter from './auth.js';
import userRouter from './user.js';
import knowledgeRouter from './knowledge.js';
import qaRouter from './qa.js';
import chatRouter from './chat.js';
import adminRouter from './admin.js';

const router = Router();

router.use('/auth', authRouter);
router.use('/users', userRouter);
router.use('/knowledge', knowledgeRouter);
router.use('/qa', qaRouter);
router.use('/chat', chatRouter);
router.use('/admin', adminRouter);

export default router;
