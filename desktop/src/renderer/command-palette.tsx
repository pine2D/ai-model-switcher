import { useEffect, useMemo, useRef, useState } from "react";

import type { CommandDescriptor, CommandId } from "../shared/commands";
import type { DesktopCopy } from "../shared/copy";
import type { PromptLibraryState } from "../shared/prompt-library";
import type { ActiveWorkspaceGroup } from "../shared/workspace";
import { CloseIcon } from "./icons";
import { commandItems, searchCommands, type PaletteCommand, type PaletteGroup } from "./command-search";
import { PromptLibrary } from "./prompt-library";

export type CommandPaletteMode = "commands" | "library" | "shortcuts";

interface CommandPaletteProps {
  readonly copy: DesktopCopy;
  readonly commands: readonly CommandDescriptor[];
  readonly groups: readonly ActiveWorkspaceGroup[];
  readonly library: PromptLibraryState;
  readonly draft: string;
  readonly isMac: boolean;
  readonly mode: CommandPaletteMode;
  readonly onModeChange: (mode: CommandPaletteMode) => void;
  readonly onExecute: (id: CommandId) => void;
  readonly onApplyGroup: (id: string) => void;
  readonly onInsertPrompt: (text: string) => void;
  readonly onSaveTemplate: (input: { readonly name: string; readonly text: string }) => void;
  readonly onDeleteTemplate: (id: string) => void;
  readonly onClose: () => void;
}

const GROUP_LABEL_KEYS: Readonly<Record<PaletteGroup, keyof DesktopCopy>> = {
  navigate: "commandGroupNavigate",
  compose: "commandGroupCompose",
  results: "commandGroupResults",
  app: "commandGroupApp",
  saved: "commandGroupSaved"
};

function groupLabel(copy: DesktopCopy, group: PaletteGroup): string {
  return copy[GROUP_LABEL_KEYS[group]];
}

function shortcutText(item: PaletteCommand): string {
  return [item.accelerator, ...item.aliases].filter(Boolean).join(" · ");
}

export function CommandPalette(props: CommandPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const results = useMemo(() => searchCommands(query, props.commands, props.copy, {
    groups: props.groups,
    isMac: props.isMac
  }), [props.commands, props.copy, props.groups, props.isMac, query]);
  const shortcuts = useMemo(() => commandItems(props.commands, props.copy, {
    isMac: props.isMac
  }).filter((item) => item.accelerator || item.aliases.length), [props.commands, props.copy, props.isMac]);
  const visible = props.mode === "commands" ? results : shortcuts;

  useEffect(() => {
    if (props.mode === "commands") inputRef.current?.focus();
    else panelRef.current?.focus();
  }, [props.mode]);
  useEffect(() => setActiveIndex(0), [query, props.mode]);
  useEffect(() => {
    document.getElementById(`command-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const run = (item: PaletteCommand | undefined): void => {
    if (!item) return;
    if (item.groupId) props.onApplyGroup(item.groupId);
    else if (item.commandId) props.onExecute(item.commandId);
  };
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
    } else if (props.mode === "library") {
      return;
    } else if (event.key === "ArrowDown" && visible.length) {
      event.preventDefault();
      setActiveIndex((activeIndex + 1) % visible.length);
    } else if (event.key === "ArrowUp" && visible.length) {
      event.preventDefault();
      setActiveIndex((activeIndex - 1 + visible.length) % visible.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(visible[activeIndex]);
    }
  };

  return (
    <main className="command-surface" aria-label={props.mode === "commands" ? props.copy.commandPalette : props.mode === "library" ? props.copy.promptLibrary : props.copy.keyboardShortcuts} aria-keyshortcuts="Escape" onKeyDown={onKeyDown}>
      <section className="command-palette" ref={panelRef} tabIndex={-1}>
        <header>
          <div className="command-view-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={props.mode === "commands"} onClick={() => props.onModeChange("commands")}>{props.copy.showCommands}</button>
            <button type="button" role="tab" aria-selected={props.mode === "library"} onClick={() => props.onModeChange("library")}>{props.copy.showPromptLibrary}</button>
            <button type="button" role="tab" aria-selected={props.mode === "shortcuts"} onClick={() => props.onModeChange("shortcuts")}>{props.copy.keyboardShortcuts}</button>
          </div>
          <button type="button" className="command-close" title={props.copy.closeCommandPalette} aria-label={props.copy.closeCommandPalette} onClick={props.onClose}><CloseIcon /></button>
        </header>
        {props.mode === "commands" ? (
          <label className="command-search">
            <span className="sr-only">{props.copy.commandPalette}</span>
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              autoComplete="off"
              spellCheck={false}
              value={query}
              placeholder={props.copy.commandSearchPlaceholder}
              aria-controls="command-results"
              aria-expanded="true"
              aria-activedescendant={visible[activeIndex] ? `command-option-${activeIndex}` : undefined}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        ) : props.mode === "shortcuts" ? <p className="command-subtitle">{props.copy.shortcutReferenceHint}</p> : null}
        {props.mode === "library" ? <PromptLibrary
          copy={props.copy}
          draft={props.draft}
          templates={props.library.templates}
          history={props.library.history}
          onInsert={props.onInsertPrompt}
          onSave={props.onSaveTemplate}
          onDelete={props.onDeleteTemplate}
        /> : <div id="command-results" className="command-results" role="listbox" aria-label={props.mode === "commands" ? props.copy.commandPalette : props.copy.keyboardShortcuts}>
          {visible.length ? visible.map((item, index) => (
            <button
              type="button"
              id={`command-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""}
              key={item.id}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => run(item)}
            >
              <span><strong>{item.label}</strong><small>{groupLabel(props.copy, item.group)}</small></span>
              {shortcutText(item) ? <kbd>{shortcutText(item)}</kbd> : null}
            </button>
          )) : <p className="command-empty">{props.copy.commandSearchEmpty}</p>}
        </div>}
        {props.mode === "commands" ? <footer>{props.copy.commandSearchHint}</footer> : null}
      </section>
    </main>
  );
}
