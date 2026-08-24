import { SITE_KEYS, type SiteDefinition, type SiteKey } from "./contracts";
import type { Tier } from "./protocol";
import { validSyncTime } from "./sync";

export const GROUP_NAME_LIMIT = 80;
export type ScopePresetKey = "all" | "clear" | "image" | "intl" | "domestic";

export interface ActiveWorkspaceGroup {
  readonly id: string;
  readonly name: string;
  readonly sites: readonly SiteKey[];
  readonly updatedAt: number;
  readonly deviceId: string;
}

export interface WorkspaceGroupTombstone {
  readonly id: string;
  readonly updatedAt: number;
  readonly deletedAt: number;
  readonly deviceId: string;
}

export type WorkspaceGroup = ActiveWorkspaceGroup | WorkspaceGroupTombstone;

export interface WorkspaceState {
  readonly selectedSites: readonly SiteKey[];
  readonly groups: readonly ActiveWorkspaceGroup[];
  readonly tier: Tier;
}

interface GroupInput {
  readonly id: string;
  readonly name: string;
  readonly sites: readonly unknown[];
}

interface VersionContext {
  readonly now: number;
  readonly deviceId: string;
}

export function normalizeSelection(value: unknown): SiteKey[] {
  if (!Array.isArray(value)) return [];
  const selected = new Set(value.filter((site): site is SiteKey =>
    typeof site === "string" && SITE_KEYS.includes(site as SiteKey)
  ));
  return SITE_KEYS.filter((site) => selected.has(site));
}

export function workspacePresets(
  sites: readonly SiteDefinition[]
): Readonly<Record<ScopePresetKey, readonly SiteKey[]>> {
  return {
    all: sites.map((site) => site.key),
    clear: [],
    image: sites.filter((site) => site.image).map((site) => site.key),
    intl: sites.filter((site) => site.intl).map((site) => site.key),
    domestic: sites.filter((site) => !site.intl).map((site) => site.key)
  };
}

export function groupSignature(sites: readonly SiteKey[]): string {
  return [...sites].sort().join(",");
}

export function createWorkspaceGroup(
  input: GroupInput,
  context: VersionContext
): ActiveWorkspaceGroup {
  const id = String(input.id ?? "").trim();
  const name = String(input.name ?? "").trim();
  const sites = normalizeSelection(input.sites);
  if (!id || id.length > 128) throw new Error("invalid_group_id");
  if (!name || [...name].length > GROUP_NAME_LIMIT) throw new Error("invalid_group_name");
  if (sites.length === 0) throw new Error("invalid_group_sites");
  if (!validSyncTime(context.now) || !context.deviceId) throw new Error("invalid_group_version");
  return { id, name, sites, updatedAt: context.now, deviceId: context.deviceId };
}

export function tombstoneWorkspaceGroup(
  group: WorkspaceGroup,
  now: number,
  deviceId: string
): WorkspaceGroupTombstone {
  if (!validSyncTime(now) || !deviceId) throw new Error("invalid_group_version");
  return { id: group.id, updatedAt: now, deletedAt: now, deviceId };
}

export function isActiveWorkspaceGroup(group: WorkspaceGroup): group is ActiveWorkspaceGroup {
  return !("deletedAt" in group);
}
