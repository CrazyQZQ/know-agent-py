-- Docker compose 初始化：启用 pgvector + pg_trgm 扩展
-- 库由 POSTGRES_DB 环境变量自动创建；此脚本在 PG 首次启动时由 entrypoint 执行。
-- 与 scripts/init_db.sql 的区别：本脚本不建库（compose 已建），仅建扩展，供 docker-entrypoint-initdb.d 挂载。
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
