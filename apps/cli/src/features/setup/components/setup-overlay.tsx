import { useMemo, useState } from "react";
import { randomBytes } from "node:crypto";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { SecureField } from "../../../components/secure-field";
import { TextField } from "../../../components/text-field";
import { COLORS } from "../../../theme";
import { writeServerEnv, type EnvValues } from "../../../lib/server-env";
import { currentEnv, envTargets, maskSecret } from "../config";
import { configuredProviders, PROVIDERS, providerForModel } from "../providers";

type FieldKind = "text" | "secret";

type Field = {
  id: string;
  label: string;
  kind: FieldKind;
};

const FIELDS: Field[] = [
  { id: "mongo", label: "MongoDB URI", kind: "text" },
  { id: "port", label: "API port", kind: "text" },
  { id: "host", label: "API host", kind: "text" },
  ...PROVIDERS.map((provider) => ({
    id: `provider:${provider.env}`,
    label: `${provider.label} key`,
    kind: "secret" as const,
  })),
  { id: "model", label: "Default model", kind: "text" },
];

type SetupOverlayProps = {
  onClose: () => void;
  /** Called with a short summary after the configuration was written. */
  onSaved: (message: string) => void;
};

/**
 * `/setup` — edit the API configuration without leaving the app.
 *
 * The terminal wizard (`nimo setup`) and this screen write the same files
 * through the same helpers, so a value saved here is exactly what the server
 * reads on its next start.
 */
export function SetupOverlay({ onClose, onSaved }: SetupOverlayProps) {
  const dimensions = useTerminalDimensions();

  const [initial] = useState<EnvValues>(() => currentEnv());
  const [values, setValues] = useState<Record<string, string>>(() => ({
    mongo: initial.MONGODB_URI ?? "",
    port: initial.PORT ?? "5000",
    host: initial.HOST ?? "127.0.0.1",
    model: initial.AI_MODEL ?? "anthropic/claude-sonnet-4-5",
  }));
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [focusIndex, setFocusIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const focus = FIELDS[focusIndex] ?? FIELDS[0]!;

  const providerByField = useMemo(
    () =>
      new Map(
        PROVIDERS.map((provider) => [`provider:${provider.env}`, provider]),
      ),
    [],
  );

  const submit = () => {
    const nextErrors: Record<string, string | undefined> = {};

    const mongo = (values.mongo ?? "").trim();
    if (!mongo) {
      nextErrors.mongo = "A MongoDB URI is required.";
    } else if (!/^mongodb(\+srv)?:\/\//.test(mongo)) {
      nextErrors.mongo = "The URI must start with mongodb:// or mongodb+srv://.";
    }

    const port = (values.port ?? "").trim();
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber <= 0 || portNumber >= 65536) {
      nextErrors.port = "Enter a port between 1 and 65535.";
    }

    if (!(values.host ?? "").trim()) {
      nextErrors.host = "A host is required.";
    }

    if (!(values.model ?? "").trim()) {
      nextErrors.model = "A default model is required.";
    }

    const next: EnvValues = { ...initial };
    next.MONGODB_URI = mongo;
    next.PORT = port;
    next.HOST = (values.host ?? "").trim();
    next.AI_MODEL = (values.model ?? "").trim();

    for (const provider of PROVIDERS) {
      const edit = (keys[provider.env] ?? "").trim();
      if (!edit) continue;
      if (edit === "-") delete next[provider.env];
      else next[provider.env] = edit;
    }

    if (configuredProviders(next).length === 0) {
      nextErrors.providers = "Add at least one provider key.";
    }

    const modelProvider = providerForModel(next.AI_MODEL ?? "");
    if (modelProvider && !next[modelProvider.env]?.trim()) {
      nextErrors.model = `${next.AI_MODEL} needs ${modelProvider.env}.`;
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setNotice(null);
      return;
    }

    if (!next.JWT_SECRET || next.JWT_SECRET.trim().length < 32) {
      next.JWT_SECRET = randomBytes(48).toString("hex");
    }

    try {
      const targets = envTargets();
      for (const target of targets) writeServerEnv(next, target);
      onSaved(
        `Saved to ${targets.length} file${targets.length === 1 ? "" : "s"}. Restart the API to apply the new keys.`,
      );
    } catch (error) {
      setNotice(
        `Could not save the configuration: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      key.preventDefault();
      onClose();
      return;
    }

    if (key.name === "tab") {
      key.preventDefault();
      const delta = key.shift ? -1 : 1;
      const next = (focusIndex + delta + FIELDS.length) % FIELDS.length;
      setFocusIndex(next);
      return;
    }

    if (key.name === "return" || key.name === "enter" || key.name === "linefeed") {
      key.preventDefault();
      submit();
    }
  });

  const panelWidth = Math.max(46, Math.min(88, dimensions.width - 4));
  const panelHeight = Math.max(12, Math.min(FIELDS.length + 8, dimensions.height - 4));

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
        height={panelHeight}
        border
        borderStyle="rounded"
        borderColor={COLORS.border}
        backgroundColor={COLORS.background}
        title=" Setup "
        titleColor={COLORS.brand}
        titleAlignment="left"
        flexDirection="column"
      >
        <box height={1} paddingX={1}>
          <text fg={COLORS.dim} wrapMode="word">
            Values are written to every Nimo config file. Leave a provider key
            empty to keep it, or type “-” to remove it.
          </text>
        </box>

        <scrollbox flexGrow={1} minHeight={0}>
          {FIELDS.map((field, index) => {
            const provider = providerByField.get(field.id);
            const existing = provider ? initial[provider.env] : undefined;
            const placeholder = provider
              ? existing
                ? `set ${maskSecret(existing)} — type a new key to replace it`
                : "not set — paste a key"
              : undefined;

            const error =
              errors[field.id] ?? (field.id.startsWith("provider:") ? errors.providers : undefined);

            const focused = index === focusIndex;

            if (field.kind === "secret") {
              return (
                <SecureField
                  key={field.id}
                  label={field.label}
                  value={keys[provider?.env ?? ""] ?? ""}
                  placeholder={placeholder}
                  focused={focused}
                  error={error}
                  compact
                  onFocusRequest={() => setFocusIndex(index)}
                  onChange={(value) => {
                    setKeys((current) => ({ ...current, [provider?.env ?? ""]: value }));
                    setErrors((current) => ({ ...current, providers: undefined }));
                  }}
                />
              );
            }

            return (
              <TextField
                key={field.id}
                label={field.label}
                value={values[field.id] ?? ""}
                placeholder={placeholder}
                focused={focused}
                error={error}
                compact
                onFocusRequest={() => setFocusIndex(index)}
                onChange={(value) => {
                  setValues((current) => ({ ...current, [field.id]: value }));
                  setErrors((current) => ({ ...current, [field.id]: undefined }));
                }}
              />
            );
          })}
        </scrollbox>

        {notice && (
          <box paddingX={1} height={1}>
            <text fg={COLORS.error} truncate>
              {notice}
            </text>
          </box>
        )}

        <box height={1} paddingX={1}>
          <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
            tab next field · enter save · esc cancel
          </text>
        </box>
      </box>
    </box>
  );
}
