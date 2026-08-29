import { useMemo, useState } from "react";

import type { DesktopCopy } from "../shared/copy";
import type { PromptHistoryItem, PromptTemplate } from "../shared/prompt-library";
import { SaveIcon, TrashIcon } from "./icons";

interface PromptLibraryProps {
  readonly copy: DesktopCopy;
  readonly draft: string;
  readonly templates: readonly PromptTemplate[];
  readonly history: readonly PromptHistoryItem[];
  readonly onInsert: (text: string) => void;
  readonly onSave: (input: { readonly name: string; readonly text: string }) => void;
  readonly onDelete: (id: string) => void;
}

export function PromptLibrary(props: PromptLibraryProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const templates = useMemo(() => props.templates.filter((item) =>
    !needle || `${item.name}\n${item.text}`.toLocaleLowerCase().includes(needle)
  ), [needle, props.templates]);
  const history = useMemo(() => props.history.filter((item) =>
    !needle || item.text.toLocaleLowerCase().includes(needle)
  ), [needle, props.history]);
  const save = () => {
    if (!name.trim() || !props.draft.trim()) return;
    props.onSave({ name: name.trim(), text: props.draft });
    setName("");
  };
  return (
    <section className="prompt-library" aria-label={props.copy.promptLibrary}>
      <label className="command-search">
        <span className="sr-only">{props.copy.promptLibrarySearch}</span>
        <input type="search" autoComplete="off" value={query} placeholder={props.copy.promptLibrarySearch} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="prompt-template-save">
        <input name="prompt-template-name" autoComplete="off" maxLength={80} value={name} placeholder={props.copy.promptTemplateName} aria-label={props.copy.promptTemplateName} onChange={(event) => setName(event.target.value)} />
        <button type="button" disabled={!name.trim() || !props.draft.trim()} onClick={save}><SaveIcon />{props.copy.saveCurrentPrompt}</button>
      </div>
      <div className="prompt-library-results">
        {templates.length ? <h2>{props.copy.promptTemplates}</h2> : null}
        {templates.map((item) => (
          <div className="prompt-library-item" key={item.id}>
            <button type="button" title={item.text} onClick={() => props.onInsert(item.text)}><strong>{item.name}</strong><small>{item.text}</small></button>
            <button type="button" title={props.copy.deleteTemplate} aria-label={`${props.copy.deleteTemplate}: ${item.name}`} onClick={() => props.onDelete(item.id)}><TrashIcon /></button>
          </div>
        ))}
        {history.length ? <h2>{props.copy.recentQuestions}</h2> : null}
        {history.map((item) => <button type="button" className="prompt-history-item" title={item.text} key={item.id} onClick={() => props.onInsert(item.text)}>{item.text}</button>)}
        {!templates.length && !history.length ? <p className="command-empty">{props.copy.promptLibraryEmpty}</p> : null}
      </div>
    </section>
  );
}
