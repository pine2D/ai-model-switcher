import { useEffect, useState } from "react";

import type { ArchivePatch, ArchiveRecord } from "../shared/archive";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { PendingSynthesis, SynthesisCandidate } from "../shared/synthesis";
import { describeCollectionCode } from "../shared/status-copy";
import { ArchiveSynthesis } from "./archive-synthesis";
import { SparklesIcon, StarIcon } from "./icons";
import { MarkdownPreview } from "./markdown-preview";

interface ArchiveDetailProps {
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly record: ArchiveRecord;
  readonly onPatch: (patch: ArchivePatch) => void;
  readonly onOpenSource: (url: string) => void;
  readonly pendingSynthesis: PendingSynthesis | null;
  readonly synthesisCandidate: SynthesisCandidate | null;
  readonly busy: boolean;
  readonly onSynthesize: () => void;
  readonly onCollectSynthesis: () => void;
  readonly onSaveSynthesis: (replaceExisting: boolean) => void;
}

export function ArchiveDetail(props: ArchiveDetailProps): React.JSX.Element {
  const { copy, record } = props;
  const [tags, setTags] = useState(record.tags.join(", "));
  const [note, setNote] = useState(record.note);
  useEffect(() => { setTags(record.tags.join(", ")); setNote(record.note); }, [record]);
  const saveTags = () => props.onPatch({
    tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean)
  });
  const favoriteLabel = record.favorite ? copy.unfavoriteArchive : copy.favoriteArchive;
  const canSynthesize = record.results.filter((result) => !!result.text?.trim()).length >= 2;
  return (
    <article className="archive-detail">
      <header className="archive-detail-heading">
        <div>
          <h1>{record.task || record.text}</h1>
          <time dateTime={new Date(record.ts).toISOString()}>
            {formatCopy(copy.archiveCapturedAt, { time: new Date(record.ts).toLocaleString(props.locale) })}
          </time>
          {record.source ? <button type="button" className="archive-source" title={record.source.url} onClick={() => props.onOpenSource(record.source!.url)}>{copy.archiveSource}: {record.source.title || record.source.url}</button> : null}
        </div>
        <div className="archive-detail-actions">
          {canSynthesize ? <button type="button" title={copy.synthesisAction} aria-label={copy.synthesisAction} disabled={props.busy} onClick={props.onSynthesize}><SparklesIcon /></button> : null}
          <button type="button" className={record.favorite ? "active" : ""} title={favoriteLabel} aria-label={favoriteLabel} aria-pressed={record.favorite} onClick={() => props.onPatch({ favorite: !record.favorite })}><StarIcon /></button>
        </div>
      </header>
      <div className="archive-fields">
        <label>{copy.archiveTags}<input value={tags} onChange={(event) => setTags(event.target.value)} onBlur={saveTags} onKeyDown={(event) => { if (event.key === "Enter") saveTags(); }} /></label>
        <label>{copy.archiveNote}<textarea maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} onBlur={() => props.onPatch({ note })} /></label>
      </div>
      <nav className="archive-answer-nav" aria-label={copy.siteViews}>
        {record.results.map((result, index) => <a key={`${result.host}:${index}`} href={`#archive-answer-${index}`}>{result.label}</a>)}
      </nav>
      <div className="archive-answers">
        {record.results.map((result, index) => {
          const successful = !!result.text?.trim();
          const best = record.winnerHost === result.host;
          const tier = result.state === "think" ? ` · ${copy.think}` : result.state === "fast" ? ` · ${copy.fast}` : "";
          return (
            <section className="archive-answer" id={`archive-answer-${index}`} key={`${result.host}:${index}`}>
              <header><h2>{result.label}{tier}</h2>{successful ? <button type="button" aria-label={best ? copy.unmarkBest : copy.markBest} aria-pressed={best} onClick={() => props.onPatch({ winnerHost: best ? null : result.host })}>{best ? <StarIcon /> : null}<span>{best ? copy.unmarkBest : copy.markBest}</span></button> : null}</header>
              <MarkdownPreview value={successful ? result.text! : `> ${describeCollectionCode(copy, result.code)}`} />
            </section>
          );
        })}
      </div>
      <ArchiveSynthesis copy={copy} record={record} pending={props.pendingSynthesis} candidate={props.synthesisCandidate} busy={props.busy} onCollect={props.onCollectSynthesis} onSave={props.onSaveSynthesis} />
    </article>
  );
}
