import { randomUUID } from "node:crypto";

import { SITE_KEYS, type SiteKey } from "../shared/contracts";
import type { Tier } from "../shared/protocol";
import {
  createWorkspaceGroup,
  groupSignature,
  isActiveWorkspaceGroup,
  normalizeSelection,
  tombstoneWorkspaceGroup,
  workspacePresets,
  type ActiveWorkspaceGroup,
  type WorkspaceGroup,
  type WorkspaceGroupTombstone,
  type WorkspaceState
} from "../shared/workspace";
import type { MetaRepository } from "./meta-repository";
import { SITES } from "./sites";
import type { StateRepository } from "./state-repository";

const WORKSPACE_KEY = "workspace";
const GROUP_PREFIX = "group:";

interface StoredWorkspace {
  readonly selectedSites: readonly SiteKey[];
  readonly tier: Tier;
  readonly updatedAt: number;
  readonly deviceId: string;
}

interface SaveGroupInput {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly sites?: unknown;
}

interface WorkspaceServiceOptions {
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly createDeviceId?: () => string;
}

type NavigateSite = (site: SiteKey, url: string) => void | Promise<void>;

function strictSelection(value: unknown, allowEmpty: boolean): SiteKey[] {
  if (!Array.isArray(value)) throw new Error("invalid_site_selection");
  const seen = new Set<SiteKey>();
  for (const item of value) {
    if (typeof item !== "string" || !SITE_KEYS.includes(item as SiteKey)) {
      throw new Error("unknown_site");
    }
    const site = item as SiteKey;
    if (seen.has(site)) throw new Error("duplicate_site");
    seen.add(site);
  }
  if (!allowEmpty && seen.size === 0) throw new Error("no_selected_sites");
  return SITE_KEYS.filter((site) => seen.has(site));
}

function validTier(value: unknown): value is Tier {
  return value === null || value === "fast" || value === "think";
}

function validGroup(value: unknown): value is WorkspaceGroup {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspaceGroup>;
  return typeof candidate.id === "string" && typeof candidate.updatedAt === "number";
}

export class WorkspaceService {
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly createDeviceId: () => string;

  constructor(
    private readonly state: StateRepository,
    private readonly meta: MetaRepository,
    private readonly navigate: NavigateSite,
    options: WorkspaceServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.createDeviceId = options.createDeviceId ?? randomUUID;
  }

  getState(): WorkspaceState {
    const stored = this.state.get<Partial<StoredWorkspace>>(WORKSPACE_KEY);
    const selectedSites = stored && Array.isArray(stored.selectedSites)
      ? normalizeSelection(stored.selectedSites)
      : [...SITE_KEYS];
    const tier = stored && validTier(stored.tier) ? stored.tier : null;
    const groups = this.state.list<unknown>(GROUP_PREFIX)
      .filter(validGroup)
      .filter(isActiveWorkspaceGroup);
    return { selectedSites, tier, groups };
  }

  setSelection(value: unknown): WorkspaceState {
    const selectedSites = strictSelection(value, true);
    this.writeWorkspace(selectedSites, this.getState().tier);
    return this.getState();
  }

  setTier(value: unknown): WorkspaceState {
    if (!validTier(value)) throw new Error("invalid_tier");
    this.writeWorkspace(this.getState().selectedSites, value);
    return this.getState();
  }

  saveGroup(input: SaveGroupInput): ActiveWorkspaceGroup {
    if (!input || typeof input !== "object") throw new Error("invalid_group");
    const sites = strictSelection(input.sites, true);
    const signature = groupSignature(sites);
    const reserved = Object.entries(workspacePresets(SITES))
      .filter(([key]) => key !== "clear")
      .some(([, preset]) => groupSignature(preset) === signature);
    if (reserved) throw new Error("reserved_group_sites");
    const existingGroups = this.getState().groups;
    const requestedId = typeof input.id === "string" && input.id.trim() ? input.id : null;
    if (existingGroups.some((group) => group.id !== requestedId && groupSignature(group.sites) === signature)) {
      throw new Error("duplicate_group_sites");
    }
    const sameName = existingGroups.find((group) => group.name === String(input.name ?? "").trim());
    const group = createWorkspaceGroup({
      id: requestedId ?? sameName?.id ?? this.createId(),
      name: typeof input.name === "string" ? input.name : "",
      sites
    }, { now: this.now(), deviceId: this.deviceId() });
    this.state.put(`${GROUP_PREFIX}${group.id}`, group, group.updatedAt);
    return group;
  }

  deleteGroup(id: unknown): WorkspaceGroupTombstone {
    if (typeof id !== "string" || !id.trim() || id.length > 128) throw new Error("invalid_group_id");
    const group = this.state.get<WorkspaceGroup>(`${GROUP_PREFIX}${id}`);
    if (!validGroup(group) || !isActiveWorkspaceGroup(group)) throw new Error("group_not_found");
    const deleted = tombstoneWorkspaceGroup(group, this.now(), this.deviceId());
    this.state.put(`${GROUP_PREFIX}${id}`, deleted, deleted.updatedAt);
    return deleted;
  }

  async newSession(value: unknown): Promise<void> {
    const sites = strictSelection(value, false);
    await Promise.all(sites.map((site) => {
      const definition = SITES.find((candidate) => candidate.key === site);
      if (!definition) throw new Error("unknown_site");
      return this.navigate(site, definition.url);
    }));
  }

  private writeWorkspace(selectedSites: readonly SiteKey[], tier: Tier): void {
    const updatedAt = this.now();
    this.state.put<StoredWorkspace>(WORKSPACE_KEY, {
      selectedSites,
      tier,
      updatedAt,
      deviceId: this.deviceId()
    }, updatedAt);
  }

  private deviceId(): string {
    const stored = this.meta.get<unknown>("deviceId");
    if (typeof stored === "string" && stored) return stored;
    return this.meta.put("deviceId", this.createDeviceId());
  }
}
