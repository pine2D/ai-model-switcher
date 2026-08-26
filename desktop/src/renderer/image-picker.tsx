import { useEffect, useRef } from "react";

import { formatCopy, type DesktopCopy } from "../shared/copy";
import {
  validateImageFiles,
  validateImages,
  type DesktopImage,
  type ImageInputError
} from "../shared/images";
import { CloseIcon, ImagePlusIcon, WarningIcon } from "./icons";
import { usePresence } from "./presence";

interface ImagePickerProps {
  readonly copy: DesktopCopy;
  readonly images: readonly DesktopImage[];
  readonly open: boolean;
  readonly disabled: boolean;
  readonly warning: string | null;
  readonly warningCount: number;
  readonly error: string | null;
  readonly onOpenChange: (value: boolean) => void;
  readonly onFiles: (files: readonly File[]) => void;
  readonly onRemove: (index: number) => void;
  readonly onAdjustScope: () => void;
}

export type ImageReadResult =
  | { readonly ok: true; readonly images: readonly DesktopImage[] }
  | { readonly ok: false; readonly code: ImageInputError };

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject();
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function readDesktopImages(files: readonly File[]): Promise<ImageReadResult> {
  const metadataError = validateImageFiles(files);
  if (metadataError) return { ok: false, code: metadataError };
  try {
    const payloads = await Promise.all(files.map(async (file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: await readDataUrl(file)
    })));
    const images = validateImages(payloads);
    return images ? { ok: true, images } : { ok: false, code: "image_invalid" };
  } catch {
    return { ok: false, code: "image_invalid" };
  }
}

export function ImagePicker(props: ImagePickerProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const count = props.images.length;
  const trayOpen = props.open && count > 0;
  const trayPresent = usePresence(trayOpen, 140);
  const manageLabel = formatCopy(props.copy.manageImages, { count });
  useEffect(() => {
    if (!props.open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") props.onOpenChange(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [props.onOpenChange, props.open]);
  const choose = () => {
    if (!inputRef.current) return;
    inputRef.current.value = "";
    inputRef.current.click();
  };
  return (
    <div className="image-picker priority-p0">
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        name="images"
        accept="image/png,image/jpeg"
        multiple
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          if (files.length) props.onFiles(files);
        }}
      />
      <button
        type="button"
        className={count ? "image-trigger active" : "image-trigger"}
        title={count ? manageLabel : props.copy.addImages}
        aria-label={count ? manageLabel : props.copy.addImages}
        aria-pressed={count > 0}
        aria-expanded={count ? props.open : undefined}
        aria-controls={count ? "image-tray" : undefined}
        data-image-count={count}
        disabled={props.disabled}
        onClick={() => count ? props.onOpenChange(!props.open) : choose()}
      >
        <ImagePlusIcon />{count ? <span className="image-count">{count}</span> : null}
      </button>
      {props.warning ? (
        <div className="image-warning" role="alert">
          <button type="button" title={props.warning} aria-label={formatCopy(props.copy.adjustImageScope, { count: props.warningCount })} onClick={props.onAdjustScope}>
            <WarningIcon /><span>{props.warningCount}</span>
          </button>
        </div>
      ) : null}
      {props.error ? (
        <div className="image-error" role="alert">
          <button type="button" title={props.error} aria-label={props.error} onClick={() => count ? props.onOpenChange(true) : choose()}>
            <WarningIcon />
          </button>
        </div>
      ) : null}
      {trayPresent ? (
        <div id="image-tray" className="image-tray" role="group" aria-label={manageLabel} aria-hidden={trayOpen ? undefined : true} inert={!trayOpen} data-state={trayOpen ? "open" : "closed"}>
          <div className="image-tray-heading">
            <span>{manageLabel}</span>
            <button type="button" title={props.copy.replaceImages} aria-label={props.copy.replaceImages} onClick={choose}><ImagePlusIcon /></button>
            <button type="button" title={props.copy.closeImages} aria-label={props.copy.closeImages} onClick={() => props.onOpenChange(false)}><CloseIcon /></button>
          </div>
          <div className="image-previews">
            {props.images.map((image, index) => (
              <div className="image-preview" key={`${image.name}:${index}`}>
                <img src={image.dataUrl} alt={image.name} width={52} height={40} />
                <button type="button" title={formatCopy(props.copy.removeImage, { name: image.name })} aria-label={formatCopy(props.copy.removeImage, { name: image.name })} onClick={() => props.onRemove(index)}><CloseIcon /></button>
              </div>
            ))}
          </div>
          {props.error || props.warning ? <p role={props.error ? "alert" : undefined}>{props.error ?? props.warning}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
