-- know-agent (Python) PostgreSQL 初始化
-- 统一一种关系型数据库：业务数据 + pgvector 向量 + langgraph checkpoint。
-- 表结构由 Alembic 迁移管理（阶段 1），本脚本只负责建库与 pgvector 扩展。

-- 1. 建库（需 superuser 权限执行；数据库名与 DATABASE_URL 中对应）
CREATE DATABASE know_agent;

-- 2. 连接到新库并启用 pgvector 扩展
--    （\connect 为 psql 元命令；若用其他客户端请手动连接到 know_agent 后执行下行）
\connect know_agent

CREATE EXTENSION IF NOT EXISTS vector;
