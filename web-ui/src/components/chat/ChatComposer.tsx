import * as React from "react";
import { Button, Input } from "antd";
import { Sender, Suggestion } from "@ant-design/x";
import { LoaderCircle } from "lucide-react";

// 用 antd Input.TextArea 替换 Sender 默认输入，固定 aria-label="Message"
// 以保留测试与无障碍语义。Sender 通过 ref 控制 triggerSend，必须 forwardRef。
const MessageInput = React.forwardRef<
  React.ComponentRef<typeof Input.TextArea>,
  React.ComponentProps<typeof Input.TextArea>
>(({ ...props }, ref) => <Input.TextArea {...props} ref={ref} aria-label="Message" variant="borderless" />);
MessageInput.displayName = "MessageInput";

export interface ChatSuggestionItem {
  label: React.ReactNode;
  value: string;
  icon?: React.ReactNode;
}

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
  isStreaming?: boolean;
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
  suggestions?: ChatSuggestionItem[];
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  isStreaming = false,
  onStop,
  disabled = false,
  placeholder = "Message",
  suggestions,
}: ChatComposerProps) {
  const renderSender = (onTrigger?: (info?: unknown) => void) => (
    <Sender
      value={value}
      onChange={(v) => {
        onChange(v);
        onTrigger?.();
      }}
      onSubmit={(v) => onSend(v)}
      loading={isStreaming}
      onCancel={onStop}
      disabled={disabled || isStreaming}
      placeholder={placeholder}
      submitType="enter"
      autoSize={{ minRows: 1, maxRows: 6 }}
      components={{ input: MessageInput }}
      suffix={(_, info) =>
        isStreaming
          ? <Button shape="circle" aria-label="Stop generating" onClick={onStop} icon={<LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />} />
          : <info.components.SendButton aria-label="Send message" disabled={disabled || !value.trim()} />
      }
    />
  );

  if (!suggestions?.length) return renderSender();

  return (
    <Suggestion
      items={suggestions}
      onSelect={(v) => onChange(v)}
      block
    >
      {({ onTrigger }) => renderSender(onTrigger)}
    </Suggestion>
  );
}
