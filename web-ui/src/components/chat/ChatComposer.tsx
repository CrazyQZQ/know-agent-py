import { useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { LoaderCircle, Send } from "lucide-react";

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
  isStreaming?: boolean;
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  isStreaming = false,
  onStop,
  disabled = false,
  placeholder = "Message",
}: ChatComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submit = () => {
    const text = value.trim();
    if (!text || disabled || isStreaming) return;
    onSend(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };
  const onInput = (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value);

  return (
    <div className="flex items-end gap-2 rounded-xl border border-border bg-background p-2">
      <textarea
        ref={inputRef}
        value={value}
        onChange={onInput}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled || isStreaming}
        rows={1}
        aria-label="Message"
        className="min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
      />
      {isStreaming ? (
        <button type="button" aria-label="Stop generating" title="Stop generating" onClick={onStop} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted hover:bg-muted/80">
          <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        </button>
      ) : (
        <button type="button" aria-label="Send message" title="Send message" onClick={submit} disabled={disabled || !value.trim()} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50">
          <Send className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
