import { describe, expect, it, afterEach } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { parseEnv } from "../../src/config/env.js";

/**
 * parseEnv merges a dotenv file into `process.env` without overriding values
 * that are already set (shell/vitest env wins, as in production). To test
 * specific values we must clear the keys first and restore them afterwards.
 */
const ALL_KEYS = [
  "NODE_ENV",
  "PORT",
  "HOST",
  "DATABASE_URL",
  "CORS_ORIGIN",
  "LOG_LEVEL",
  "AI_SERVICE_URL",
  "AI_SERVICE_TOKEN",
] as const;

const ORIGINALS: Record<string, string | undefined> = {};

function clearKeys(): void {
  ORIGINALS.NODE_ENV = process.env.NODE_ENV;
  ORIGINALS.PORT = process.env.PORT;
  ORIGINALS.HOST = process.env.HOST;
  ORIGINALS.DATABASE_URL = process.env.DATABASE_URL;
  ORIGINALS.CORS_ORIGIN = process.env.CORS_ORIGIN;
  ORIGINALS.LOG_LEVEL = process.env.LOG_LEVEL;
  ORIGINALS.AI_SERVICE_URL = process.env.AI_SERVICE_URL;
  ORIGINALS.AI_SERVICE_TOKEN = process.env.AI_SERVICE_TOKEN;

  delete process.env.NODE_ENV;
  delete process.env.PORT;
  delete process.env.HOST;
  delete process.env.DATABASE_URL;
  delete process.env.CORS_ORIGIN;
  delete process.env.LOG_LEVEL;
  delete process.env.AI_SERVICE_URL;
  delete process.env.AI_SERVICE_TOKEN;
}

function restoreKeys(): void {
  for (const key of ALL_KEYS) {
    if (ORIGINALS[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINALS[key];
    }
  }
}

function writeTempEnv(lines: string[]): string {
  const path = `${process.cwd()}/.env.test.tmp`;
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

function removeTempEnv(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

afterEach(() => {
  restoreKeys();
});

describe("parseEnv", () => {
  it("parses a valid environment into typed values", () => {
    clearKeys();
    const path = writeTempEnv([
      "NODE_ENV=development",
      "PORT=5000",
      "HOST=127.0.0.1",
      "DATABASE_URL=postgresql://user:pass@db:5432/aegis?schema=public",
      "CORS_ORIGIN=http://example.com, http://panel.example.com",
      "LOG_LEVEL=debug",
      "AI_SERVICE_URL=http://127.0.0.1:8555",
    ]);
    try {
      const env = parseEnv(path);
      expect(env.NODE_ENV).toBe("development");
      expect(env.PORT).toBe(5000);
      expect(env.HOST).toBe("127.0.0.1");
      expect(env.CORS_ORIGIN).toEqual([
        "http://example.com",
        "http://panel.example.com",
      ]);
      expect(env.LOG_LEVEL).toBe("debug");
      expect(env.AI_SERVICE_URL).toBe("http://127.0.0.1:8555");
      expect(env.AI_SERVICE_TIMEOUT_MS).toBe(15000);
    } finally {
      removeTempEnv(path);
    }
  });

  it("applies defaults for optional variables", () => {
    clearKeys();
    const path = writeTempEnv([
      "DATABASE_URL=postgresql://user:pass@db:5432/aegis?schema=public",
      "AI_SERVICE_URL=http://127.0.0.1:8555",
    ]);
    try {
      const env = parseEnv(path);
      expect(env.NODE_ENV).toBe("development");
      expect(env.PORT).toBe(4000);
      expect(env.CORS_ORIGIN).toEqual(["*"]);
    } finally {
      removeTempEnv(path);
    }
  });

  it("fails fast and lists issues when required configuration is missing", () => {
    clearKeys();
    const path = writeTempEnv(["NODE_ENV=development", "PORT=4000"]);
    try {
      expect(() => parseEnv(path)).toThrow(/DATABASE_URL/);
    } finally {
      removeTempEnv(path);
    }
  });

  it("fails when PORT is not a valid port number", () => {
    clearKeys();
    const path = writeTempEnv([
      "DATABASE_URL=postgresql://user:pass@db:5432/aegis?schema=public",
      "PORT=not-a-number",
    ]);
    try {
      expect(() => parseEnv(path)).toThrow(/PORT/);
    } finally {
      removeTempEnv(path);
    }
  });

  it("fails when NODE_ENV is not one of the allowed values", () => {
    clearKeys();
    const path = writeTempEnv([
      "DATABASE_URL=postgresql://user:pass@db:5432/aegis?schema=public",
      "NODE_ENV=staging",
    ]);
    try {
      expect(() => parseEnv(path)).toThrow(/NODE_ENV/);
    } finally {
      removeTempEnv(path);
    }
  });

  it("fails when the database url is not a postgres connection string", () => {
    clearKeys();
    const path = writeTempEnv([
      "DATABASE_URL=mysql://user:pass@localhost:3306/aegis",
    ]);
    try {
      expect(() => parseEnv(path)).toThrow(/DATABASE_URL/);
    } finally {
      removeTempEnv(path);
    }
  });
});
