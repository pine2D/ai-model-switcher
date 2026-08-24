import { useMemo, useState } from "react";

import type { ArchiveRecord } from "../shared/archive";
import type { SiteDefinition } from "../shared/contracts";
import type { DesktopCopy } from "../shared/copy";
import type { Tier } from "../shared/protocol";
import {
  buildSynthesisPrompt,
  selectedSynthesisAnswers,
  SYNTHESIS_PROMPT_LIMIT,
  type SynthesisSendRequest
} from "../shared/synthesis";
import { CloseIcon, SendIcon, SparklesIcon, StopIcon } from "./icons";

interface SynthesisWorkspaceProps {
  readonly copy: DesktopCopy;
  readonly record: ArchiveRecord;
  readonly sites: readonly SiteDefinition[];
  readonly defaultTier: Tier;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSend: (request: SynthesisSendRequest) => void;
}

export function SynthesisWorkspace(props: SynthesisWorkspaceProps): React.JSX.Element {
  const successful = useMemo(() => props.record.results.filter((result) => !!result.text?.trim()), [props.record]);
  const [selectedHosts, setSelectedHosts] = useState(() => successful.map((result) => result.host));
  const [targetSite, setTargetSite] = useState("");
  const [tier, setTier] = useState<Tier>(props.defaultTier);
  const [instruction, setInstruction] = useState(props.copy.synthesisDefaultInstruction);
  const selected = selectedSynthesisAnswers(props.record.results, selectedHosts);
  const preview = buildSynthesisPrompt({ record: props.record, selectedHosts, instruction });
  const tooLong = [...preview].length > SYNTHESIS_PROMPT_LIMIT;
  const invalid = selected.length < 2 || !targetSite || tooLong;
  const toggle = (host: string) => setSelectedHosts((current) =>
    current.includes(host) ? current.filter((item) => item !== host) : [...current, host]);

  return (
    <section className="synthesis-workspace" aria-label={props.copy.synthesisTitle}>
      <header>
        <strong><SparklesIcon />{props.copy.synthesisTitle}</strong>
        <button type="button" title={props.busy ? props.copy.cancel : props.copy.synthesisCancel} aria-label={props.busy ? props.copy.cancel : props.copy.synthesisCancel} onClick={props.onCancel}>{props.busy ? <StopIcon /> : <CloseIcon />}</button>
      </header>
      <div className="synthesis-config">
        <fieldset>
          <legend>{props.copy.synthesisAnswers}</legend>
          {successful.map((result) => {
            const state = result.state === "think" ? props.copy.think : result.state === "fast" ? props.copy.fast : props.copy.synthesisUnknownTier;
            return <label key={result.host}><input type="checkbox" name="synthesis-answer" value={result.host} checked={selectedHosts.includes(result.host)} onChange={() => toggle(result.host)} /><span>{result.label} · {state}</span></label>;
          })}
        </fieldset>
        <small>{props.copy.synthesisCount.replace("{count}", String(selected.length))}</small>
        <label>{props.copy.synthesisTarget}<select name="synthesis-target" aria-label={props.copy.synthesisTarget} value={targetSite} onChange={(event) => setTargetSite(event.target.value)}><option value="">{props.copy.synthesisTargetMissing}</option>{props.sites.map((site) => <option value={site.key} key={site.key}>{site.label}</option>)}</select></label>
        <label>{props.copy.synthesisTier}<select name="synthesis-tier" aria-label={props.copy.synthesisTier} value={tier ?? ""} onChange={(event) => setTier(event.target.value === "think" || event.target.value === "fast" ? event.target.value : null)}><option value="">{props.copy.followSite}</option><option value="fast">{props.copy.fast}</option><option value="think">{props.copy.think}</option></select></label>
        <label>{props.copy.synthesisInstruction}<textarea name="synthesis-instruction" autoComplete="off" maxLength={4000} value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label>
      </div>
      <label className="synthesis-preview">{props.copy.synthesisPreview}<textarea name="synthesis-preview" readOnly value={preview} /></label>
      <footer>
        <span role="status" aria-live="polite">{tooLong ? props.copy.synthesisTooLong : selected.length < 2 ? props.copy.synthesisNotEnough : props.busy ? props.copy.synthesisSending : ""}</span>
        <button type="button" disabled={props.busy || invalid} onClick={() => props.onSend({ archiveId: props.record.id, targetSite: targetSite as SynthesisSendRequest["targetSite"], tier, selectedHosts, instruction })}><SendIcon />{props.copy.synthesisSend}</button>
      </footer>
    </section>
  );
}
