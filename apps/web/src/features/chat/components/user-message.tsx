export function UserMessage({ text }: { text: string }) {
  return (
    <div className="ml-auto max-w-[80%] rounded-2xl bg-muted px-4 py-2 text-sm text-foreground">
      {text}
    </div>
  );
}
