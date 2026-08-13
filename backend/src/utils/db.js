import mongoose from 'mongoose';
import { config } from '../config/env.js';

export async function connectMongo() {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    console.log('MongoDB 连接成功');
  });

  mongoose.connection.on('error', (error) => {
    console.error('MongoDB 连接错误:', error.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB 已断开连接');
  });

  try {
    await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: config.mongodbConnectTimeout
    });
  } catch (error) {
    console.error('MongoDB 启动连接失败:', error.message);
    throw error;
  }
}