import type { AccessTokenProvider } from "./drive-client";
import {
  authorizeWithPkce,
  refreshAccessToken,
  revokeGoogleToken,
  type OAuthClientCredentials,
  type TokenSet
} from "./oauth-pkce";
import type { TokenStore } from "./token-store";

interface OAuthSessionOptions {
  readonly credentials: OAuthClientCredentials | null;
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
    return !!this.options.credentials;
  }

  securePersistence(): boolean {
    return this.options.tokenStore.securePersistence();
  }

  async connect(): Promise<void> {
    const credentials = this.requireClient();
    const token = await (this.options.authorize ?? authorizeWithPkce)({
      ...credentials,
      scope: this.options.scope,
      openExternal: this.options.openExternal,
      fetch: this.options.fetch
    });
    let refreshToken = token.refreshToken;
    if (!refreshToken) {
      try { refreshToken = await this.options.tokenStore.load(); }
      catch { throw new Error("token_store_failed"); }
    }
    if (!refreshToken) throw new Error("refresh_token_missing");
    try { await this.options.tokenStore.save(refreshToken); }
    catch { throw new Error("token_store_failed"); }
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
    const rotatedRefreshToken = token.refreshToken && token.refreshToken !== refreshToken ? token.refreshToken : refreshToken;
    if (rotatedRefreshToken !== refreshToken) {
      try { await this.options.tokenStore.save(rotatedRefreshToken); }
      catch { /* keep the rotated token in memory even if persisting it fails */ }
    }
    this.token = { ...token, refreshToken: rotatedRefreshToken };
    return token.accessToken;
  }

  async disconnect(): Promise<void> {
    const token = this.token?.refreshToken ?? await this.options.tokenStore.load().catch(() => null) ?? this.token?.accessToken;
    this.token = null;
    try { if (token) await (this.options.revoke ?? revokeGoogleToken)(token, this.options.fetch); }
    finally { await this.options.tokenStore.clear(); }
  }

  private requireClient(): OAuthClientCredentials {
    if (!this.options.credentials) throw new Error("oauth_not_configured");
    return this.options.credentials;
  }
}
