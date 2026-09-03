import axios from 'axios';
import { config } from '../config/env.js';

const CHROMA_API_VERSION = 'v2';
const DEFAULT_COLLECTION_NAME = 'enterprise_knowledge_chunks';

function normalizeBaseUrl(baseUrl = '') {
  return String(baseUrl || '').replace(/\/$/, '');
}

function getChromaBaseUrl() {
  const baseUrl = normalizeBaseUrl(config.chromaBaseUrl);
  if (!baseUrl) {
    throw new Error('未配置 CHROMA_BASE_URL，无法使用向量检索');
  }
  return baseUrl;
}

function getCollectionPath(collectionId = '') {
  return `${getChromaBaseUrl()}/api/${CHROMA_API_VERSION}/tenants/${encodeURIComponent(config.chromaTenant)}/databases/${encodeURIComponent(config.chromaDatabase)}/collections${collectionId ? `/${encodeURIComponent(collectionId)}` : ''}`;
}

function getClient() {
  return axios.create({
    baseURL: getChromaBaseUrl(),
    timeout: config.chromaTimeout,
    headers: { 'Content-Type': 'application/json' }
  });
}

function normalizeMetadata(metadata = {}) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) && value !== '')
  );
}

export async function getOrCreateCollection() {
  const client = getClient();
  const collectionPath = getCollectionPath();
  const name = config.chromaCollection || DEFAULT_COLLECTION_NAME;

  try {
    const response = await client.post(collectionPath, {
      name,
      configuration: { hnsw: { space: 'cosine' } }
    });
    return response.data;
  } catch (error) {
    if (error.response?.status !== 409) throw error;

    const response = await client.get(collectionPath, { params: { limit: 100 } });
    const collection = response.data?.find((item) => item.name === name);
    if (!collection) throw new Error(`Chroma collection 未找到：${name}`, { cause: error });
    return collection;
  }
}

// 删除整个 collection（v2 API 按名称寻址）。用于更换 embedding 模型后重建索引。
export async function deleteCollection(collectionName) {
  const client = getClient();
  const name = collectionName || config.chromaCollection || DEFAULT_COLLECTION_NAME;
  await client.delete(`${getCollectionPath()}/${encodeURIComponent(name)}`);
}

export async function upsertChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return;

  const collection = await getOrCreateCollection();
  const client = getClient();
  const ids = chunks.map((chunk) => String(chunk.id || chunk._id));

  if (ids.some((id) => !id || id === 'undefined')) {
    throw new Error('写入 Chroma 失败：chunk 缺少 id');
  }

  await client.post(`${getCollectionPath(collection.id)}/upsert`, {
    ids,
    documents: chunks.map((chunk) => String(chunk.content || '')),
    embeddings: chunks.map((chunk) => chunk.embedding),
    metadatas: chunks.map((chunk) => normalizeMetadata({
      chunkId: String(chunk.id || chunk._id),
      documentId: String(chunk.documentId),
      categoryId: String(chunk.categoryId),
      title: String(chunk.title || ''),
      chunkIndex: Number(chunk.chunkIndex || 0)
    }))
  });
}

export async function queryChunks(queryEmbedding, { categoryId, topK = 5 } = {}) {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) return [];

  const collection = await getOrCreateCollection();
  const client = getClient();
  const response = await client.post(`${getCollectionPath(collection.id)}/query`, {
    query_embeddings: [queryEmbedding],
    n_results: Math.max(1, Number(topK) || 5),
    where: categoryId ? { categoryId: String(categoryId) } : undefined,
    include: ['documents', 'metadatas', 'distances']
  });

  const ids = response.data?.ids?.[0] || [];
  const documents = response.data?.documents?.[0] || [];
  const metadatas = response.data?.metadatas?.[0] || [];
  const distances = response.data?.distances?.[0] || [];

  return ids.map((id, index) => ({
    id,
    content: documents[index] || '',
    metadata: metadatas[index] || {},
    distance: Number(distances[index] || 0),
    score: 1 - Number(distances[index] || 0)
  }));
}

export async function deleteDocumentChunks(documentId) {
  if (!documentId) return;

  const collection = await getOrCreateCollection();
  const client = getClient();
  await client.post(`${getCollectionPath(collection.id)}/delete`, {
    where: { documentId: String(documentId) }
  });
}
