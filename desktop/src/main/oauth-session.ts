import type { AccessTokenProvider } from "./drive-client";
import {
  authorizeWithPkce,
  refreshAccessToken,
  revokeGoogleToken,
  type TokenSet
} from "./oauth-pkce";
import type { TokenStore } from "./token-store";

interface OAuthSessionOptions {
  readonly clientId: string | null;
  readonly scope: string;
  readonly tokenStore: TokenStore;
  readonly openExternal: (url: string) => Promise<void>;
  readonly authorize?: typeof authorizeWithPkce;
  readonly refresh?: typeof refreshAccessToken;
  readonly revoke?: typeof revokeGoogleToken;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

export class OAuthSession implements AccessTokenProvider {
  private readonly now: () => number;
  private token: TokenSet | null = null;

  constructor(private readonly options: OAuthSessionOptions) {
    this.now = options.now ?? Date.now;
  }

  configured(): boolean {
    return !!this.options.clientId;
  }

  securePersistence(): boolean {
    return this.options.tokenStore.securePersistence();
  }

  async connect(): Promise<void> {
    const clientId = this.requireClient();
    const token = await (this.options.authorize ?? authorizeWithPkce)({
      clientId,
      scope: this.options.scope,
      openExternal: this.options.openExternal,
      fetch: this.options.fetch
    });
    const refreshToken = token.refreshToken ?? await this.options.tokenStore.load();
    if (!refreshToken) throw new Error("refresh_token_missing");
    await this.options.tokenStore.save(refreshToken);
    this.token = { ...token, refreshToken };
  }

  async accessToken(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh && this.token && this.token.expiresAt > this.now() + 60_000) return this.token.accessToken;
    const refreshToken = this.token?.refreshToken ?? await this.options.tokenStore.load();
    if (!refreshToken) throw new Error("auth_failed");
    const token = await (this.options.refresh ?? refreshAccessToken)(
      this.requireClient(),
      refreshToken,
      this.options.fetch,
      this.now
    );
    this.token = { ...token, refreshToken };
    return token.accessToken;
  }

  async disconnect(): Promise<void> {
    const token = this.token?.refreshToken ?? await this.options.tokenStore.load() ?? this.token?.accessToken;
    this.token = null;
    try { if (token) await (this.options.revoke ?? revokeGoogleToken)(token, this.options.fetch); }
    finally { await this.options.tokenStore.clear(); }
  }

  private requireClient(): string {
    if (!this.options.clientId) throw new Error("oauth_not_configured");
    return this.options.clientId;
  }
}
