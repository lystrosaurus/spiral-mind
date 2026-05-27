import { readFile } from "node:fs/promises";

export type EnvMap = Record<string, string>;
export type MutableEnv = Record<string, string | undefined>;
export type ApplyDotEnvOptions = {
  readonly override?: boolean | undefined;
};

export function parseDotEnv(source: string): EnvMap {
  const env: EnvMap = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    env[key] = unquote(rawValue);
  }

  return env;
}

export function applyDotEnv(
  values: EnvMap,
  target: MutableEnv,
  options: ApplyDotEnvOptions = {},
): void {
  const override = options.override ?? true;

  for (const [key, value] of Object.entries(values)) {
    if (override || target[key] === undefined) {
      target[key] = value;
    }
  }
}

export async function loadDotEnvFile(
  path = ".env",
  target: MutableEnv = process.env,
  options?: ApplyDotEnvOptions,
): Promise<void> {
  try {
    const source = await readFile(path, "utf8");
    applyDotEnv(parseDotEnv(source), target, options);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }
}

function unquote(value: string): string {
  const first = value.at(0);
  const last = value.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
