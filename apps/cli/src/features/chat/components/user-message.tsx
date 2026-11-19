import { COLORS } from "../../../theme";

export function UserMessage({ text }: { text: string }) {
  return (
    <box width="100%" flexDirection="row" justifyContent="flex-end">
      <box
        maxWidth="85%"
        border
        borderStyle="rounded"
        borderColor={COLORS.border}
        backgroundColor={COLORS.panel}
        paddingX={1}
      >
        <text wrapMode="word" fg={COLORS.text}>
          {text}
        </text>
      </box>
    </box>
  );
}
