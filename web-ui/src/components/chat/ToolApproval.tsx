import { Check, ShieldAlert, X } from "lucide-react";

export interface ToolApprovalProps {
  title: string;
  description?: string;
  onApprove: () => void;
  onReject: () => void;
  disabled?: boolean;
}

export function ToolApproval({ title, description, onApprove, onReject, disabled = false }: ToolApprovalProps) {
  return (
    <section className="flex max-w-md items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" aria-label="Tool approval">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onApprove} disabled={disabled} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground">
            <Check className="h-3.5 w-3.5" aria-hidden /> Approve
          </button>
          <button type="button" onClick={onReject} disabled={disabled} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
            <X className="h-3.5 w-3.5" aria-hidden /> Reject
          </button>
        </div>
      </div>
    </section>
  );
}
