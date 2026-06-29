/**
 * 向量存储端口 [EXTENSION POINT]
 *
 * 用户可通过实现此接口接入不同的向量数据库（HNSW、Pinecone 等）。
 */

/** 向量条目 */
export interface VectorEntry {
  id: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}

/** 搜索结果 */
export interface VectorSearchResult {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/** 向量存储端口接口 */
export interface VectorStorePort {
  /** 添加向量 */
  add(entries: VectorEntry[]): Promise<void>;

  /** 搜索最相似的向量 */
  search(query: number[], topK: number): Promise<VectorSearchResult[]>;

  /** 删除指定 ID 的向量 */
  remove(ids: string[]): Promise<void>;

  /** 清空所有向量 */
  clear(): Promise<void>;

  /** 获取存储中的向量数量 */
  count(): Promise<number>;

  /** 持久化到磁盘（如有需要） */
  save(path: string): Promise<void>;

  /** 从磁盘加载（如有需要） */
  load(path: string): Promise<void>;
}
