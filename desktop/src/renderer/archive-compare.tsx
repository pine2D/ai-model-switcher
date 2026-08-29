import { useEffect, useMemo, useState } from "react";

import type { ArchiveResult } from "../shared/archive";
import { compareAnswerParagraphs, type ComparedParagraph } from "../shared/archive-compare";
import type { DesktopCopy } from "../shared/copy";

interface ArchiveCompareProps {
  readonly copy: DesktopCopy;
  readonly results: readonly ArchiveResult[];
}

function ComparisonColumn(props: {
  readonly copy: DesktopCopy;
  readonly label: string;
  readonly paragraphs: readonly ComparedParagraph[];
}): React.JSX.Element {
  return (
    <article className="archive-compare-column">
      <h3>{props.label}</h3>
      {props.paragraphs.map((paragraph, index) => (
        <div className={`archive-compare-paragraph ${paragraph.relation}`} data-relation={paragraph.relation} key={`${index}:${paragraph.text}`}>
          <span>{paragraph.relation === "shared" ? props.copy.sharedParagraph : props.copy.uniqueParagraph}</span>
          <p>{paragraph.text}</p>
        </div>
      ))}
    </article>
  );
}

export function ArchiveCompare(props: ArchiveCompareProps): React.JSX.Element {
  const results = props.results.filter((result) => !!result.text?.trim());
  const resultKey = results.map((result) => result.host).join("\n");
  const [leftHost, setLeftHost] = useState(results[0]?.host ?? "");
  const [rightHost, setRightHost] = useState(results[1]?.host ?? "");
  useEffect(() => {
    setLeftHost(results[0]?.host ?? "");
    setRightHost(results[1]?.host ?? "");
  }, [resultKey]);
  const left = results.find((result) => result.host === leftHost) ?? results[0];
  const right = results.find((result) => result.host === rightHost) ?? results[1];
  const comparison = useMemo(
    () => compareAnswerParagraphs(left?.text ?? "", right?.text ?? ""),
    [left?.text, right?.text]
  );

  return (
    <section className="archive-compare" aria-labelledby="archive-compare-title">
      <header>
        <h2 id="archive-compare-title">{props.copy.answerComparison}</h2>
        <p>{props.copy.answerComparisonDescription}</p>
      </header>
      <div className="archive-compare-selectors">
        <label>{props.copy.leftAnswer}
          <select name="compare-left" value={left?.host ?? ""} onChange={(event) => setLeftHost(event.target.value)}>
            {results.map((result) => <option value={result.host} disabled={result.host === right?.host} key={result.host}>{result.label}</option>)}
          </select>
        </label>
        <label>{props.copy.rightAnswer}
          <select name="compare-right" value={right?.host ?? ""} onChange={(event) => setRightHost(event.target.value)}>
            {results.map((result) => <option value={result.host} disabled={result.host === left?.host} key={result.host}>{result.label}</option>)}
          </select>
        </label>
      </div>
      <div className="archive-compare-grid">
        <ComparisonColumn copy={props.copy} label={left?.label ?? ""} paragraphs={comparison.left} />
        <ComparisonColumn copy={props.copy} label={right?.label ?? ""} paragraphs={comparison.right} />
      </div>
    </section>
  );
}
