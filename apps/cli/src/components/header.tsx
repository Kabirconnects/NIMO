function Header() {
  // echo "⌬ ◈ ❖ ⟁ ✺ ⚘"
  return (
    <box width="100%" alignItems="flex-start" paddingTop={1} paddingBottom={1}>
      <box
        flexDirection="row"
        justifyContent="flex-start"
        alignItems="center"
        gap={1}
      >
        <ascii-font font="block" text="Nimo" color={["#D77757", "#8A4A33"]} />
        <ascii-font font="block" text="-" color={["#A8A8A8", "#5C5C5C"]} />
        <ascii-font font="block" text="AGENT" color={["#F0B49A", "#B0654A"]} />
      </box>

      <text fg="#4A4A4A">────────────────────────────</text>
      <box flexDirection="row">
        <text fg="#F0B49A">⌬ Himanshu Arodia</text>
        <text fg="#666666">.</text>
        <text fg="#999999">Your AI agent in the terminal</text>
      </box>
    </box>
  );
}

export default Header;
