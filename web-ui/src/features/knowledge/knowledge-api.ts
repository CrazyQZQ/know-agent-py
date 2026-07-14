import { apiRequest } from "@/lib/api-client";
export type DocumentRow = { id: number; title: string; status: string; updated_at: string; knowledge_base_type?: string };
export type DocumentPage = { items: DocumentRow[]; total: number; current?: number; size?: number };
export function listDocuments(token: string, current = 1, size = 10) { const params = new URLSearchParams({ current: String(current), size: String(size) }); return apiRequest<DocumentPage>(`/v1/api/document/page?${params}`, { token }); }
export async function listAllDocuments(token: string): Promise<DocumentRow[]> { const all: DocumentRow[] = []; let current = 1; const size = 100; while (true) { const page = await listDocuments(token, current, size); all.push(...page.items); if (all.length >= page.total || page.items.length < size) return all; current += 1; } }
export function deleteDocument(token: string, id: number) { return apiRequest<void>(`/v1/api/document/${id}`, { method: "DELETE", token }); }
