import { useRef, useState } from "react";
import { ChevronDown, FileText, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/AuthProvider";
import { apiRequest } from "@/lib/api-client";

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

  const selectedRoleLabels = ROLE_OPTIONS.filter((item) => roles.includes(item.value)).map((item) => item.label);

  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent className="max-w-xl gap-5 rounded-[22px] border-border/65 p-0 shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
      <DialogHeader className="px-6 pt-6">
        <DialogTitle className="text-xl">上传文档</DialogTitle>
        <DialogDescription>选择文件后会自动填写标题和描述，提交后进入知识库处理流程。</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 px-6">
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
          <Input ref={fileInputRef} type="file" aria-label="选择文件" className="sr-only" onChange={(event) => { if (event.target.files?.[0]) choose(event.target.files[0]); }} />
          {file ? <div className="flex items-center gap-3 text-left"><span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-background shadow-sm"><FileText className="h-5 w-5" /></span><div><div className="max-w-80 truncate text-sm font-medium">{file.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{Math.max(1, Math.round(file.size / 1024))} KB · 点击更换文件</div></div></div> : <div><span className="mx-auto flex h-11 w-11 items-center justify-center rounded-[14px] border border-border/65 bg-background shadow-sm"><UploadCloud className="h-5 w-5" /></span><div className="mt-3 text-sm font-medium">拖拽文件到此处</div><div className="mt-1 text-xs text-muted-foreground">或点击选择本地文件</div></div>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium">标题<Input aria-label="标题" value={title} onChange={(event) => setTitle(event.target.value)} className="rounded-[12px]" /></label>
          <label className="space-y-1.5 text-sm font-medium">知识库类型
            <Select value={type} onValueChange={setType}>
              <SelectTrigger aria-label="知识库类型"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="DOCUMENT_SEARCH">文档检索</SelectItem><SelectItem value="DATA_QUERY">数据查询</SelectItem></SelectContent>
            </Select>
          </label>
        </div>

        <label className="block space-y-1.5 text-sm font-medium">描述<Textarea aria-label="描述" value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-20 resize-none rounded-[12px]" /></label>

        <div className="space-y-1.5 text-sm font-medium">可访问角色
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-10 w-full justify-between rounded-[12px] px-3 font-normal">
                <span className={selectedRoleLabels.length ? "text-foreground" : "text-muted-foreground"}>{selectedRoleLabels.length ? selectedRoleLabels.join("、") : "公开（所有角色可访问）"}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
              {ROLE_OPTIONS.map((role) => <DropdownMenuCheckboxItem key={role.value} checked={roles.includes(role.value)} onCheckedChange={(checked) => toggleRole(role.value, checked === true)}>{role.label}</DropdownMenuCheckboxItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DialogFooter className="border-t border-border/50 px-6 py-4">
        <Button type="button" variant="ghost" className="rounded-full" onClick={onClose}>取消</Button>
        <Button type="button" className="rounded-full px-5" disabled={!file || submitting} onClick={() => void submit()}>{submitting ? "上传中..." : "上传"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
