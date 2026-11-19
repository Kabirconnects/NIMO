import { useEffect, useMemo, useRef } from "react";
import {
  TextAttributes,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { COLORS } from "../theme";

export type MenuGroupRow = {
  type: "group";
  id: string;
  label: string;
};

export type MenuItemRow = {
  type: "item";
  id: string;
  label: string;
  /** Short right-aligned text (provider, badge, current value). */
  hint?: string;
  /** Longer explanation shown at the bottom for the highlighted row. */
  description?: string;
  disabled?: boolean;
};

export type MenuRow = MenuGroupRow | MenuItemRow;

type MenuOverlayProps = {
  title: string;
  subtitle?: string;
  rows: MenuRow[];
  selectedId: string | null;
  maxRows?: number;
  footer?: string;
  onSelect: (id: string) => void;
  onExecute: (id: string) => void;
  onClose: () => void;
};

export function MenuOverlay({
  title,
  subtitle,
  rows,
  selectedId,
  maxRows = 12,
  footer = "↑ ↓ move   ·   enter select   ·   esc close",
  onSelect,
  onExecute,
  onClose,
}: MenuOverlayProps) {
  const dimensions = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const lastSelectedId = useRef<string | null>(null);

  const items = useMemo(
    () => rows.filter((row): row is MenuItemRow => row.type === "item"),
    [rows],
  );

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selectedId),
  );
  const selectedItem = items[selectedIndex];

  const viewportHeight = Math.max(
    5,
    Math.min(maxRows, rows.length || maxRows, dimensions.height - 9),
  );
  const panelWidth = Math.max(36, Math.min(94, dimensions.width - 4));

  // Open the list scrolled to the current value, not to the top. Only react to
  // selection changes, so a manual scroll is not undone by an unrelated render.
  useEffect(() => {
    if (lastSelectedId.current === selectedId) return;
    lastSelectedId.current = selectedId;
    if (!selectedId) return;

    const scrollbox = scrollRef.current;
    const rowIndex = rows.findIndex((row) => row.id === selectedId);
    if (!scrollbox || rowIndex === -1) return;

    const height = scrollbox.viewport.height || viewportHeight;
    if (rowIndex < scrollbox.scrollTop) {
      scrollbox.scrollTo(Math.max(0, rowIndex - 1));
    } else if (rowIndex > scrollbox.scrollTop + height - 1) {
      scrollbox.scrollTo(rowIndex - height + 1);
    }
  }, [rows, selectedId, viewportHeight]);

  const moveSelection = (delta: number) => {
    if (items.length === 0) return;

    const nextIndex = Math.min(
      items.length - 1,
      Math.max(0, selectedIndex + delta),
    );
    const next = items[nextIndex];
    if (!next) return;

    onSelect(next.id);

    const rowIndex = rows.findIndex((row) => row.id === next.id);
    const scrollbox = scrollRef.current;

    if (scrollbox && rowIndex !== -1) {
      if (rowIndex < scrollbox.scrollTop) {
        scrollbox.scrollTo(rowIndex);
      } else if (rowIndex > scrollbox.scrollTop + viewportHeight - 1) {
        scrollbox.scrollTo(rowIndex - viewportHeight + 1);
      }
    }
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      key.preventDefault();
      onClose();
      return;
    }

    if (key.name === "up" || key.name === "k") {
      key.preventDefault();
      moveSelection(-1);
      return;
    }

    if (key.name === "down" || key.name === "j") {
      key.preventDefault();
      moveSelection(1);
      return;
    }

    if (key.name === "home") {
      key.preventDefault();
      const first = items[0];
      if (first) {
        onSelect(first.id);
        scrollRef.current?.scrollTo(0);
      }
      return;
    }

    if (key.name === "end") {
      key.preventDefault();
      const last = items[items.length - 1];
      if (last) {
        onSelect(last.id);
        scrollRef.current?.scrollTo(Math.max(0, rows.length - viewportHeight));
      }
      return;
    }

    if (key.name === "return" || key.name === "enter") {
      key.preventDefault();
      if (selectedItem && !selectedItem.disabled) onExecute(selectedItem.id);
    }
  });

  const detail =
    selectedItem?.description ??
    (selectedItem?.disabled
      ? "This model is unavailable on the server. Add its provider API key and restart the API."
      : subtitle);

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={50}
      backgroundColor={COLORS.background}
      alignItems="center"
      justifyContent="center"
    >
      <box
        width={panelWidth}
        height={viewportHeight + 6}
        border
        borderStyle="rounded"
        borderColor={COLORS.border}
        backgroundColor={COLORS.background}
        title={` ${title} `}
        titleAlignment="left"
        flexDirection="column"
      >
        <scrollbox ref={scrollRef} height={viewportHeight}>
          {rows.length === 0 ? (
            <box height={1} paddingX={1}>
              <text fg={COLORS.muted}>Nothing to show here.</text>
            </box>
          ) : null}

          {rows.map((row) => {
            if (row.type === "group") {
              return (
                <box key={row.id} height={1} paddingX={1}>
                  <text fg={COLORS.brand} attributes={TextAttributes.BOLD}>
                    {row.label}
                  </text>
                </box>
              );
            }

            const isSelected = row.id === selectedItem?.id;

            return (
              <box
                key={row.id}
                flexDirection="row"
                height={1}
                paddingX={1}
                overflow="hidden"
                backgroundColor={isSelected ? COLORS.selection : undefined}
                onMouseMove={() => onSelect(row.id)}
                onMouseDown={() => {
                  if (!row.disabled) onExecute(row.id);
                }}
              >
                <text
                  selectable={false}
                  truncate
                  fg={
                    isSelected
                      ? COLORS.selectionText
                      : row.disabled
                        ? COLORS.faint
                        : COLORS.text
                  }
                >
                  {row.label}
                </text>
                <box flexGrow={1} />
                {row.hint && (
                  <text
                    selectable={false}
                    truncate
                    fg={isSelected ? COLORS.selectionText : COLORS.muted}
                    attributes={TextAttributes.DIM}
                  >
                    {row.hint}
                  </text>
                )}
              </box>
            );
          })}
        </scrollbox>

        <box height={3} paddingX={1} overflow="hidden">
          <text fg={COLORS.dim} wrapMode="word">
            {detail ?? ""}
          </text>
        </box>

        <box height={1} paddingX={1}>
          <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
            {footer}
          </text>
        </box>
      </box>
    </box>
  );
}
