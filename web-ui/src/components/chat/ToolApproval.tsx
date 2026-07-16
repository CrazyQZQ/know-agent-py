import { Alert, Button } from "antd";
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
    <Alert
      aria-label="Tool approval"
      type="warning"
      showIcon
      icon={<ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden />}
      title={<h3 className="text-sm font-medium">{title}</h3>}
      description={description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : undefined}
      action={
        <div className="flex gap-2">
          <Button size="small" type="primary" aria-label="Approve" disabled={disabled} onClick={onApprove} icon={<Check className="h-3.5 w-3.5" />}>Approve</Button>
          <Button size="small" aria-label="Reject" disabled={disabled} onClick={onReject} icon={<X className="h-3.5 w-3.5" />}>Reject</Button>
        </div>
      }
    />
  );
}
