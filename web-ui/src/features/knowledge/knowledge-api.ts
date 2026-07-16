import { apiRequest } from "@/lib/api-client";
export type DocumentRow = { id: number; title: string; status: string; updated_at: string; knowledge_base_type?: string };
type DocumentRecord = { doc_id: number; doc_title: string; status: string; updated_at: string | null; knowledge_base_type?: string };
export type DocumentPage = { records: DocumentRecord[]; total: number; current?: number; size?: number };
export type RoleOption = { name: string; displayName?: string };
export function listRoles(token: string) { return apiRequest<RoleOption[]>("/v1/api/document/roles", { token }); }
export function listDocuments(token: string, current = 1, size = 10) { const params = new URLSearchParams({ current: String(current), size: String(size) }); return apiRequest<DocumentPage>(`/v1/api/document/page?${params}`, { token }); }
export async function listAllDocuments(token: string): Promise<DocumentRow[]> { const all: DocumentRow[] = []; let current = 1; const size = 100; while (true) { const page = await listDocuments(token, current, size); all.push(...page.records.map(r => ({ id: r.doc_id, title: r.doc_title, status: r.status, updated_at: r.updated_at ?? "", knowledge_base_type: r.knowledge_base_type }))); if (all.length >= page.total || page.records.length < size) return all; current += 1; } }
export function deleteDocument(token: string, id: number) { return apiRequest<void>(`/v1/api/document/${id}`, { token }); }
