export type MenuKey =
  | "overview"
  | "auth"
  | "agent"
  | "threads"
  | "documents"
  | "segments"
  | "ppt";

export type UserProfile = {
  name: string;
  sub: string;
  roles: string[];
  email: string;
  tokenType: "Bearer";
  expiresIn: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  time: string;
  sources?: string[];
};

export type ThreadItem = {
  threadId: string;
  title: string;
  appName: "common_agent" | "ppt_build";
  userId: string;
  messages: number;
  updatedAt: string;
};

export type DocumentStatus =
  | "CONVERTED"
  | "CHUNKED"
  | "VECTOR_STORED"
  | "STORED";

export type DocumentItem = {
  docId: number;
  docTitle: string;
  uploadUser: string;
  description: string;
  knowledgeBaseType: "DOCUMENT_SEARCH" | "DATA_QUERY";
  accessibleBy: string;
  status: DocumentStatus;
  chunks: number;
  createdAt: string;
  updatedAt: string;
};

export type DocumentLifecycleStatus =
  | "INIT"
  | "UPLOADED"
  | "CONVERTING"
  | "CONVERTED"
  | "CHUNKED"
  | "VECTOR_STORED"
  | "STORED";

export type SegmentItem = {
  id: number;
  text: string;
  chunkId: string;
  documentId: number;
  chunkOrder: number;
  embeddingId: string;
  status: "STORED" | "VECTOR_STORED";
};

export type SearchResult = {
  segmentId: number;
  text: string;
  score: number;
  source: "keyword" | "vector" | "hybrid";
  fileName: string;
};

export type GraphStep = {
  node: "requirement" | "search" | "template" | "outline" | "render";
  label: string;
  detail: string;
};

export const userProfile: UserProfile = {
  name: "qq",
  sub: "a41b9db1-demo",
  roles: ["admin", "normal_user"],
  email: "qq@example.com",
  tokenType: "Bearer",
  expiresIn: 604800
};

export const roles = [
  { name: "admin", displayName: "管理员" },
  { name: "normal_user", displayName: "普通用户" },
  { name: "auditor", displayName: "审计员" }
];

export const threads: ThreadItem[] = [
  {
    threadId: "thread-uuid-001",
    title: "知识库第一段问答",
    appName: "common_agent",
    userId: "alice",
    messages: 12,
    updatedAt: "刚刚"
  },
  {
    threadId: "thread-uuid-002",
    title: "AI 发展 PPT",
    appName: "ppt_build",
    userId: "alice",
    messages: 6,
    updatedAt: "今天 14:30"
  },
  {
    threadId: "thread-uuid-003",
    title: "销售数据查询",
    appName: "common_agent",
    userId: "chen",
    messages: 9,
    updatedAt: "昨天"
  }
];

export const chatMessages: ChatMessage[] = [
  {
    id: "m-1",
    role: "assistant",
    content:
      "已连接 common_agent。你可以发送问题，我会模拟 POST /run_sse 的 message/tool/done 事件。",
    time: "14:17",
    sources: ["GET /list-apps", "POST /run_sse"]
  },
  {
    id: "m-2",
    role: "user",
    content: "知识库里第一段讲了什么？",
    time: "14:18"
  },
  {
    id: "m-3",
    role: "tool",
    content:
      "tool: hybrid 检索命中 3 条片段，最佳来源为《产品手册.pdf》，score=0.0328。",
    time: "14:18",
    sources: ["GET /api/document/search"]
  },
  {
    id: "m-4",
    role: "assistant",
    content:
      "第一段主要说明文档进入知识库前会经历上传、解析、分块和向量化；对话时 Agent 会基于 threadId 延续上下文，并通过检索结果补充回答依据。",
    time: "14:18",
    sources: ["产品手册.pdf", "部署说明.md"]
  }
];

export const documents: DocumentItem[] = [
  {
    docId: 1,
    docTitle: "产品手册.pdf",
    uploadUser: "alice",
    description: "产品功能、术语和使用流程说明",
    knowledgeBaseType: "DOCUMENT_SEARCH",
    accessibleBy: "admin,normal_user",
    status: "VECTOR_STORED",
    chunks: 128,
    createdAt: "2026-07-07 14:00",
    updatedAt: "2026-07-07 14:12"
  },
  {
    docId: 2,
    docTitle: "销售数据.xlsx",
    uploadUser: "chen",
    description: "结构化销售数据，用于 DATA_QUERY 场景",
    knowledgeBaseType: "DATA_QUERY",
    accessibleBy: "admin",
    status: "STORED",
    chunks: 34,
    createdAt: "2026-07-07 13:42",
    updatedAt: "2026-07-07 13:45"
  },
  {
    docId: 3,
    docTitle: "部署说明.md",
    uploadUser: "ops",
    description: "后端部署、环境变量和接口说明",
    knowledgeBaseType: "DOCUMENT_SEARCH",
    accessibleBy: "公开",
    status: "CHUNKED",
    chunks: 56,
    createdAt: "2026-07-07 12:16",
    updatedAt: "2026-07-07 12:28"
  }
];

export const documentLifecycle: Array<{
  status: DocumentLifecycleStatus;
  label: string;
  action?: string;
}> = [
  { status: "INIT", label: "初始化" },
  { status: "UPLOADED", label: "文件已上传" },
  { status: "CONVERTING", label: "解析转换中" },
  { status: "CONVERTED", label: "解析完成", action: "分块" },
  { status: "CHUNKED", label: "分块完成", action: "向量化" },
  { status: "VECTOR_STORED", label: "向量入库完成" },
  { status: "STORED", label: "结构化数据入库" }
];

export const uploadDefaults = {
  uploadUser: "alice",
  title: "新产品说明.md",
  description: "用于演示上传功能的 mock 文档",
  knowledgeBaseType: "DOCUMENT_SEARCH" as const,
  accessibleBy: "admin,normal_user"
};

export const segments: SegmentItem[] = [
  {
    id: 12,
    text:
      "文档上传后会同步完成文件存储、解析为 Markdown、写入数据库，再通过分块和 embedding 进入可检索状态。",
    chunkId: "chunk-product-012",
    documentId: 1,
    chunkOrder: 0,
    embeddingId: "doc-1-segment-12",
    status: "VECTOR_STORED"
  },
  {
    id: 13,
    text:
      "Agent 对话接口使用 fetch + ReadableStream 解析 text/event-stream，message 事件用于拼接打字效果。",
    chunkId: "chunk-product-013",
    documentId: 1,
    chunkOrder: 1,
    embeddingId: "doc-1-segment-13",
    status: "VECTOR_STORED"
  },
  {
    id: 31,
    text:
      "DATA_QUERY 类型知识库用于表格数据场景，可在上传时指定 table_name，并通过角色控制访问范围。",
    chunkId: "chunk-sales-031",
    documentId: 2,
    chunkOrder: 0,
    embeddingId: "doc-2-segment-31",
    status: "STORED"
  }
];

export const searchResults: SearchResult[] = [
  {
    segmentId: 12,
    text:
      "文档上传、解析、分块、向量化后，Agent 才能在对话中稳定引用知识库内容。",
    score: 0.0328,
    source: "hybrid",
    fileName: "产品手册.pdf"
  },
  {
    segmentId: 13,
    text:
      "SSE 返回 event: message / tool / done，前端需要使用 fetch + ReadableStream 解析。",
    score: 0.0484,
    source: "vector",
    fileName: "部署说明.md"
  },
  {
    segmentId: 31,
    text:
      "上传 DATA_QUERY 类型文档时，可指定 table_name 并绑定 accessible_by 角色。",
    score: 0.0619,
    source: "keyword",
    fileName: "销售数据.xlsx"
  }
];

export const graphSteps: GraphStep[] = [
  {
    node: "requirement",
    label: "需求理解",
    detail: "提取主题、受众、页数和补充问题"
  },
  {
    node: "search",
    label: "资料检索",
    detail: "从知识库检索背景资料和案例"
  },
  {
    node: "template",
    label: "模板生成",
    detail: "准备版式、主题色和页面组件"
  },
  {
    node: "outline",
    label: "大纲生成",
    detail: "生成章节结构、每页标题和讲述顺序"
  },
  {
    node: "render",
    label: "渲染导出",
    detail: "输出 pptx 文件下载地址"
  }
];

export const streamingReply =
  "我已按 hybrid 模式检索知识库，并将工具结果合并到回答中。当前最相关的片段来自《产品手册.pdf》：文档需要先完成上传、解析、分块和向量化，随后 Agent 通过 threadId 维持多轮上下文。";
