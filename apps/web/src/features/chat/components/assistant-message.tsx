export function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="max-w-[80%] text-sm text-foreground">{text}</div>
  );
}
