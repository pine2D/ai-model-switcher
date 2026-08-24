import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface TokenCrypto {
  readonly backend: () => string;
  readonly available: () => Promise<boolean>;
  readonly encrypt: (value: string) => Promise<Buffer>;
  readonly decrypt: (value: Buffer) => Promise<string>;
}

export async function safeEncryptionAvailability(check: () => Promise<boolean>): Promise<boolean> {
  try { return await check(); }
  catch { return false; }
}

export class TokenStore {
  private memoryToken: string | null = null;

  constructor(
    private readonly path: string,
    readonly crypto: TokenCrypto
  ) {}

  securePersistence(): boolean {
    return !["basic_text", "unknown", "unavailable"].includes(this.crypto.backend());
  }

  async save(refreshToken: string): Promise<boolean> {
    if (!refreshToken) throw new Error("invalid_refresh_token");
    this.memoryToken = refreshToken;
    if (!this.securePersistence() || !await this.crypto.available()) return false;
    const encrypted = await this.crypto.encrypt(refreshToken);
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, encrypted, { mode: 0o600 });
    return true;
  }

  async load(): Promise<string | null> {
    if (this.memoryToken) return this.memoryToken;
    if (!this.securePersistence() || !await this.crypto.available()) return null;
    try {
      const token = await this.crypto.decrypt(await readFile(this.path));
      this.memoryToken = token || null;
      return this.memoryToken;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async clear(): Promise<void> {
    this.memoryToken = null;
    try { await unlink(this.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
