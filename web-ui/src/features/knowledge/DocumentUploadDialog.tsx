import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Dropdown, Input, Modal, Select } from "antd";
import { ChevronDown, FileText, UploadCloud } from "lucide-react";

import { useAuth } from "@/features/auth/AuthProvider";
import { apiRequest } from "@/lib/api-client";
import { listRoles, type RoleOption } from "./knowledge-api";

const ROLE_OPTIONS = [
  { value: "admin", label: "管理员" },
  { value: "editor", label: "编辑者" },
];

export function DocumentUploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { auth } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("DOCUMENT_SEARCH");
  const [roles, setRoles] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRolesLoading(true);
    const requestRoles = typeof listRoles === "function" ? listRoles : () => Promise.resolve([]);
    void requestRoles(auth?.token ?? "").then(setRoleOptions).catch(() => setRoleOptions([])).finally(() => setRolesLoading(false));
  }, [auth?.token, open]);

  function choose(next: File) {
    setFile(next);
    const name = next.name.replace(/\.[^.]+$/, "");
    setTitle(name);
    setDescription(name);
  }

  function toggleRole(role: string, checked: boolean) {
    setRoles((current) => checked ? [...new Set([...current, role])] : current.filter((item) => item !== role));
  }

  async function submit() {
    if (!file || submitting) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", title);
      form.append("description", description);
      form.append("knowledge_base_type", type);
      roles.forEach((role) => form.append("accessible_by", role));
      await apiRequest("/v1/api/document/upload", { method: "POST", body: form, token: auth?.token });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const availableRoles = roleOptions.length ? roleOptions.map((item) => ({ value: item.name, label: item.displayName || item.name })) : ROLE_OPTIONS;
  const selectedRoleLabels = availableRoles.filter((item) => roles.includes(item.value)).map((item) => item.label);

  const roleMenu = (
    <div className="min-w-[12rem] rounded-[14px] border border-border/65 bg-popover p-1.5 shadow-[0_18px_55px_rgba(15,23,42,0.18)]">
      {rolesLoading ? (
        <div className="px-2.5 py-2 text-[13px] text-muted-foreground">加载角色中...</div>
      ) : availableRoles.length ? (
        availableRoles.map((role) => (
          <div key={role.value} className="rounded-[10px] hover:bg-foreground/[0.055]">
            <Checkbox className="w-full px-2.5 py-2 text-[13px]" checked={roles.includes(role.value)} onChange={(event) => toggleRole(role.value, event.target.checked)}>
              {role.label}
            </Checkbox>
          </div>
        ))
      ) : (
        <div className="px-2.5 py-2 text-[13px] text-muted-foreground">暂无可用角色</div>
      )}
    </div>
  );

  return <Modal
    open={open}
    onCancel={onClose}
    keyboard={false}
    centered
    width={560}
    title={<div><div className="text-xl font-semibold">上传文档</div><div className="mt-1 text-sm font-muted-foreground" style={{ color: "hsl(var(--muted-foreground))" }}>选择文件后会自动填写标题和描述，提交后进入知识库处理流程。</div></div>}
    footer={<>
      <Button aria-label="取消" onClick={onClose}>取消</Button>
      <Button type="primary" aria-label={submitting ? "上传中..." : "上传"} disabled={!file || submitting} onClick={() => void submit()}>{submitting ? "上传中..." : "上传"}</Button>
    </>}
  >
    <div className="space-y-4 py-2">
      <div
        data-testid="upload-dropzone"
        role="button"
        tabIndex={0}
        aria-label="拖拽或选择文件"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click(); }}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files[0]) choose(event.dataTransfer.files[0]); }}
        className={`group flex min-h-36 cursor-pointer items-center justify-center rounded-[18px] border border-dashed p-5 text-center transition-colors ${dragging ? "border-blue-400 bg-blue-500/[0.06]" : "border-border/80 bg-muted/25 hover:border-foreground/25 hover:bg-muted/45"}`}
      >
        <input ref={fileInputRef} type="file" aria-label="选择文件" className="sr-only" onChange={(event) => { if (event.target.files?.[0]) choose(event.target.files[0]); }} />
        {file ? <div className="flex items-center gap-3 text-left"><span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-background shadow-sm"><FileText className="h-5 w-5" /></span><div><div className="max-w-80 truncate text-sm font-medium">{file.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{Math.max(1, Math.round(file.size / 1024))} KB · 点击更换文件</div></div></div> : <div><span className="mx-auto flex h-11 w-11 items-center justify-center rounded-[14px] border border-border/65 bg-background shadow-sm"><UploadCloud className="h-5 w-5" /></span><div className="mt-3 text-sm font-medium">拖拽文件到此处</div><div className="mt-1 text-xs text-muted-foreground">或点击选择本地文件</div></div>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><div className="text-sm font-medium">标题</div><Input aria-label="标题" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
        <div className="space-y-1.5"><div className="text-sm font-medium">知识库类型</div>
          <Select aria-label="知识库类型" value={type} onChange={setType} className="w-full">
            <Select.Option value="DOCUMENT_SEARCH">文档检索</Select.Option>
            <Select.Option value="DATA_QUERY">数据查询</Select.Option>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5"><div className="text-sm font-medium">描述</div><Input.TextArea aria-label="描述" value={description} onChange={(event) => setDescription(event.target.value)} autoSize={{ minRows: 3 }} className="resize-none" /></div>

      <div className="space-y-1.5"><div className="text-sm font-medium">可访问角色</div>
        <Dropdown trigger={["click"]} popupRender={() => roleMenu}>
          <Button className="h-10 w-full justify-between rounded-[12px] px-3 font-normal" style={{ textAlign: "left" }}>
            <span className={selectedRoleLabels.length ? "text-foreground" : "text-muted-foreground"}>{selectedRoleLabels.length ? selectedRoleLabels.join("、") : "公开（所有角色可访问）"}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </Button>
        </Dropdown>
      </div>
    </div>
  </Modal>;
}
