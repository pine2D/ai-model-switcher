import { useEffect, useState } from "react";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import {
  groupSignature,
  workspacePresets,
  type ActiveWorkspaceGroup
} from "../shared/workspace";
import { CloseIcon, SaveIcon, TrashIcon } from "./icons";

interface WorkspaceDrawerProps {
  readonly copy: DesktopCopy;
  readonly sites: readonly SiteDefinition[];
  readonly selected: ReadonlySet<SiteKey>;
  readonly groups: readonly ActiveWorkspaceGroup[];
  readonly onClose: () => void;
  readonly onSelectionChange: (sites: readonly SiteKey[]) => void;
  readonly onSaveGroup: (name: string) => void;
  readonly onDeleteGroup: (id: string) => void;
}

export function WorkspaceDrawer(props: WorkspaceDrawerProps): React.JSX.Element {
  const [name, setName] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  useEffect(() => setPendingDeleteId(null), [props.groups, props.selected]);
  const choices = workspacePresets(props.sites);
  const selectedSites = props.sites.map((site) => site.key).filter((site) => props.selected.has(site));
  const selectedSignature = groupSignature(selectedSites);
  const reservedSignatures = new Set(
    [choices.all, choices.image, choices.intl, choices.domestic].map(groupSignature)
  );
  const canSave = selectedSites.length > 0 &&
    !reservedSignatures.has(selectedSignature) &&
    !props.groups.some((group) => groupSignature(group.sites) === selectedSignature);
  const presets = [
    [props.copy.allSites, choices.all],
    [props.copy.clearSites, choices.clear],
    [props.copy.imageSites, choices.image],
    [props.copy.intlSites, choices.intl],
    [props.copy.domesticSites, choices.domestic]
  ] as const;
  const toggleSite = (site: SiteKey) => {
    const next = new Set(props.selected);
    if (next.has(site)) next.delete(site);
    else next.add(site);
    props.onSelectionChange(props.sites.map((item) => item.key).filter((key) => next.has(key)));
  };

  return (
    <aside id="workspace-drawer" className="workspace-drawer" aria-label={props.copy.scope}>
      <div className="drawer-heading">
        <strong>{props.copy.scope}</strong>
        <button type="button" title={props.copy.closeScope} aria-label={props.copy.closeScope} onClick={props.onClose}><CloseIcon /></button>
      </div>
      <div className="scope-presets" aria-label={props.copy.scope}>
        {presets.map(([label, sites]) => (
          <button type="button" className="scope-preset" key={label} onClick={() => props.onSelectionChange(sites)}>{label}</button>
        ))}
      </div>
      <section className="drawer-section">
        <h2>{props.copy.selectedSites}</h2>
        <div className="site-checklist">
          {props.sites.map((site) => (
            <label key={site.key}>
              <input type="checkbox" checked={props.selected.has(site.key)} onChange={() => toggleSite(site.key)} />
              <span>{site.label}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="drawer-section group-section">
        <h2>{props.copy.savedGroups}</h2>
        {props.groups.length === 0 ? <p>{props.copy.noSavedGroups}</p> : (
          <div className="group-list">
            {props.groups.map((group) => pendingDeleteId === group.id ? (
              <div className="group-confirm" data-group-id={group.id} key={group.id}>
                <span>{formatCopy(props.copy.confirmDeleteGroup, { group: group.name })}</span>
                <button type="button" className="danger" onClick={() => props.onDeleteGroup(group.id)}>{props.copy.confirmDelete}</button>
                <button type="button" onClick={() => setPendingDeleteId(null)}>{props.copy.cancelDelete}</button>
              </div>
            ) : (
              <div className="group-row" data-group-id={group.id} key={group.id}>
                <button type="button" className="group-apply" onClick={() => props.onSelectionChange(group.sites)}>{group.name}</button>
                <button
                  type="button"
                  title={formatCopy(props.copy.deleteGroup, { group: group.name })}
                  aria-label={formatCopy(props.copy.deleteGroup, { group: group.name })}
                  onClick={() => setPendingDeleteId(group.id)}
                ><TrashIcon /></button>
              </div>
            ))}
          </div>
        )}
        <form className="group-save" onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed || !canSave) return;
          props.onSaveGroup(trimmed);
          setName("");
        }}>
          <input value={name} maxLength={80} disabled={!canSave} aria-label={props.copy.groupNamePlaceholder} placeholder={props.copy.groupNamePlaceholder} onChange={(event) => setName(event.target.value)} />
          <button type="submit" title={props.copy.saveGroup} aria-label={props.copy.saveGroup} disabled={!name.trim() || !canSave}><SaveIcon /></button>
        </form>
      </section>
    </aside>
  );
}
