import { useEffect, useState } from "react";

export function Logo({ color = "#D77757", animate = true }) {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    if (!animate) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const id = setInterval(() => {
      setBlink(true);
      timers.push(setTimeout(() => setBlink(false), 180));
    }, 4000);
    return () => {
      clearInterval(id);
      timers.forEach(clearTimeout);
    };
  }, [animate]);

  const rows = [
    "▄▄▄▄▄▄▄▄",
    blink ? "████████" : "██ ██ ██",
    "████████",
  ];

  return (
    <box flexDirection="column">
      {rows.map((r, i) => (
        <text key={i} fg={color}>
          {r}
        </text>
      ))}
    </box>
  );
}

export default Logo;