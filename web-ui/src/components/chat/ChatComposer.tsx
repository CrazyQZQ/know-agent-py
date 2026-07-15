import { useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";

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
    <div className="relative mx-auto flex w-full max-w-[49.5rem] items-end gap-2 rounded-[22px] border border-black/[0.035] bg-card p-2 shadow-[0_12px_30px_rgba(15,23,42,0.07)] transition-colors focus-within:border-blue-300/75 dark:border-white/[0.06] dark:shadow-[0_16px_34px_rgba(0,0,0,0.28)] dark:focus-within:border-blue-400/55">
      <textarea
        ref={inputRef}
        value={value}
        onChange={onInput}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled || isStreaming}
        rows={1}
        aria-label="Message"
        className="min-h-10 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-5 outline-none placeholder:text-muted-foreground/70"
      />
      {isStreaming ? (
        <button type="button" aria-label="Stop generating" title="Stop generating" onClick={onStop} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-foreground/85 shadow-[0_3px_10px_rgba(15,23,42,0.08)] transition-transform hover:scale-[1.03] hover:bg-muted/65 active:scale-95">
          <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        </button>
      ) : (
        <button type="button" aria-label="Send message" title="Send message" onClick={submit} disabled={disabled || !value.trim()} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-foreground bg-foreground text-background shadow-[0_3px_10px_rgba(15,23,42,0.18)] transition-transform hover:scale-[1.03] hover:bg-foreground/90 active:scale-95 disabled:opacity-35 disabled:hover:scale-100">
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
