import { useEffect, useState } from "react";

import type { ArchiveRecord } from "../shared/archive";
import type { DesktopCopy } from "../shared/copy";
import type { PendingSynthesis, SynthesisCandidate } from "../shared/synthesis";
import { SparklesIcon } from "./icons";
import { MarkdownPreview } from "./markdown-preview";

interface ArchiveSynthesisProps {
  readonly copy: DesktopCopy;
  readonly record: ArchiveRecord;
  readonly pending: PendingSynthesis | null;
  readonly candidate: SynthesisCandidate | null;
  readonly busy: boolean;
  readonly onCollect: () => void;
  readonly onSave: (replaceExisting: boolean) => void;
}

export function ArchiveSynthesis(props: ArchiveSynthesisProps): React.JSX.Element | null {
  const { copy, record } = props;
  const [replaceArmed, setReplaceArmed] = useState(false);
  useEffect(() => setReplaceArmed(false), [record.id, props.candidate]);
  const pending = props.pending?.archiveId === record.id ? props.pending : null;
  const candidate = pending ? props.candidate : null;
  if (!record.synthesis && !pending) return null;
  const requestSave = () => {
    if (!record.synthesis) props.onSave(false);
    else if (replaceArmed) props.onSave(true);
    else setReplaceArmed(true);
  };
  return (
    <section className="archive-synthesis">
      {record.synthesis ? (
        <div className="synthesis-card saved">
          <header><h2><SparklesIcon />{copy.synthesisSaved}</h2><span>{record.synthesis.host}{record.synthesis.state ? ` · ${record.synthesis.state === "think" ? copy.think : copy.fast}` : ""}</span></header>
          <MarkdownPreview value={record.synthesis.text} />
        </div>
      ) : null}
      {pending ? (
        <div className="synthesis-card pending">
          {candidate ? <MarkdownPreview value={candidate.text} /> : <p>{copy.synthesisCollect}</p>}
          {candidate ? (
            <div className="synthesis-confirm">
              {replaceArmed ? <><span>{copy.synthesisReplaceConfirm}</span><button type="button" disabled={props.busy} onClick={() => setReplaceArmed(false)}>{copy.cancelDelete}</button></> : null}
              <button type="button" className={replaceArmed ? "danger" : ""} disabled={props.busy} onClick={requestSave}>{record.synthesis ? copy.synthesisReplace : copy.synthesisSave}</button>
            </div>
          ) : <button type="button" disabled={props.busy} onClick={props.onCollect}>{copy.synthesisCollect}</button>}
        </div>
      ) : null}
    </section>
  );
}
