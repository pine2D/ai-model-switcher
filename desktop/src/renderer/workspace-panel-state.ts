import type { SiteKey } from "../shared/contracts";
import { groupSignature, type ActiveWorkspaceGroup } from "../shared/workspace";

export type WorkspacePanelTab = "sites" | "health";
export type WorkspaceInputMethod = "pointer" | "keyboard";

export interface OpenWorkspacePanelState {
  readonly tab: WorkspacePanelTab;
  readonly detail: SiteKey | null;
  readonly inputMethod: WorkspaceInputMethod;
}

export type WorkspacePanelState = OpenWorkspacePanelState | null;

interface ScopeLabels {
  readonly selectSites: string;
  readonly customScope: string;
}

export function scopeDisplayName(
  selectedSites: readonly SiteKey[],
  groups: readonly ActiveWorkspaceGroup[],
  labels: ScopeLabels
): string {
  if (!selectedSites.length) return labels.selectSites;
  const signature = groupSignature(selectedSites);
  const group = groups.find((candidate) => groupSignature(candidate.sites) === signature);
  return `${group?.name ?? labels.customScope} · ${selectedSites.length}`;
}

export function openWorkspacePanel(
  tab: WorkspacePanelTab,
  inputMethod: WorkspaceInputMethod
): OpenWorkspacePanelState {
  return { tab, detail: null, inputMethod };
}

export function showWorkspaceDetail(
  state: OpenWorkspacePanelState,
  detail: SiteKey
): OpenWorkspacePanelState {
  return { ...state, tab: "health", detail };
}

export function escapeWorkspacePanel(state: WorkspacePanelState): WorkspacePanelState {
  if (!state) return null;
  return state.detail ? { ...state, detail: null } : null;
}
