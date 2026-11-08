import Logo from "./logo";

const COLORS = {
  border: "#B0654A",
  title: "#D77757",
  label: "#F0B49A",
  text: "#E6E6E6",
  dim: "#999999",
};

const VERSION = "0.1.0";

const info = [
  { label: "MODEL", value: "Nimo-1" },
  { label: "CWD", value: "D:\\Projects\\Nimo\\Nimo" },
  { label: "SESSION", value: "20261028_123511" },
];

const tools = [
  { name: "file", description: "read_file · write_file · patch" },
  { name: "shell", description: "run_command" },
  { name: "search", description: "search_files" },
  { name: "browser", description: "browser_open" },
  { name: "clarify", description: "clarify" },
];

const SKILL_COUNT = 12;

function Divider() {
  return (
    <box
      width="100%"
      height={1}
      border={["top"]}
      borderStyle="single"
      borderColor={COLORS.border}
    />
  );
}

function InfoPanel() {
  return (
    <box
      width="100%"
      border
      borderStyle="rounded"
      borderColor={COLORS.border}
      title={` ✦ Nimo AGENT · v${VERSION} `}
      titleAlignment="center"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      gap={1}
    >
      {/* Identity with logo */}
      <box flexDirection="row" alignItems="center" gap={2}>
        <Logo />
        <box flexDirection="column">
          <text fg={COLORS.title}>Nimo AGENT</text>
          <text fg={COLORS.dim}>AI agent · Terminal workspace</text>
        </box>
      </box>

      <Divider />

      {/* Two columns */}
      <box flexDirection="row" gap={4} width="100%">
        <box flexDirection="column" flexGrow={1} flexBasis={0} gap={1}>
          <text fg={COLORS.title}>SESSION INFO</text>
          <box flexDirection="column">
            {info.map((item) => (
              <box key={item.label} flexDirection="row" gap={1}>
                <box width={9}>
                  <text fg={COLORS.label}>{item.label}</text>
                </box>
                <text fg={COLORS.text}>{item.value}</text>
              </box>
            ))}
          </box>
        </box>

        <box flexDirection="column" flexGrow={1} flexBasis={0} gap={1}>
          <text fg={COLORS.title}>AVAILABLE TOOLS</text>
          <box flexDirection="column">
            {tools.map((tool) => (
              <box key={tool.name} flexDirection="row" gap={1}>
                <text fg={COLORS.label}>›</text>
                <box width={8}>
                  <text fg={COLORS.text}>{tool.name}</text>
                </box>
                <text fg={COLORS.dim}>{tool.description}</text>
              </box>
            ))}
          </box>
        </box>
      </box>

      <Divider />

      {/* Footer */}
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <box flexDirection="row" gap={1}>
          <text fg={COLORS.title}>✦</text>
          <text fg={COLORS.dim}>{SKILL_COUNT} skills loaded</text>
        </box>
        <text fg={COLORS.label}>/help for commands</text>
      </box>
    </box>
  );
}

export default InfoPanel;
