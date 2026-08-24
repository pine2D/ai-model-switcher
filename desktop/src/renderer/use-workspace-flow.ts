import { useMemo, useRef, useState } from "react";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type { Tier } from "../shared/protocol";
import type { WorkspaceState } from "../shared/workspace";

const INITIAL_WORKSPACE: WorkspaceState = { selectedSites: [], groups: [], tier: null };

export function useWorkspaceFlow(
  sites: readonly SiteDefinition[],
  failedMessage: string,
  announce: (value: string) => void
) {
  const selectionRef = useRef<readonly SiteKey[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceState>(INITIAL_WORKSPACE);
  const accept = (value: WorkspaceState): void => {
    selectionRef.current = value.selectedSites;
    setWorkspace(value);
  };
  const recover = (): void => {
    announce(failedMessage);
    void window.polyask.bootstrap().then((state) => accept(state.workspace)).catch(() => undefined);
  };
  const changeSelection = (value: readonly SiteKey[]): void => {
    const ordered = sites.map((site) => site.key).filter((key) => value.includes(key));
    selectionRef.current = ordered;
    setWorkspace((current) => ({ ...current, selectedSites: ordered }));
    void window.polyask.setSelection(ordered).then(accept).catch(recover);
  };
  const selected = useMemo(() => new Set(workspace.selectedSites), [workspace.selectedSites]);
  return {
    workspace,
    selected,
    accept,
    changeSelection,
    toggleSite: (site: SiteKey) => {
      const next = new Set(selectionRef.current);
      if (next.has(site)) next.delete(site); else next.add(site);
      changeSelection(sites.map((item) => item.key).filter((key) => next.has(key)));
    },
    changeTier: (tier: Tier) => {
      setWorkspace((current) => ({ ...current, tier }));
      void window.polyask.setTier(tier).then(accept).catch(recover);
    },
    saveGroup: async (name: string): Promise<boolean> => {
      try {
        accept(await window.polyask.saveGroup({ name, sites: [...selectionRef.current] }));
        return true;
      } catch {
        recover();
        return false;
      }
    },
    deleteGroup: (id: string) => {
      void window.polyask.deleteGroup(id).then(accept).catch(recover);
    },
    recover
  };
}
