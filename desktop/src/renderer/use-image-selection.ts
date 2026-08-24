import { useRef, useState } from "react";

import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { DesktopImage, ImageInputError } from "../shared/images";
import { readDesktopImages } from "./image-picker";

function errorCopy(copy: DesktopCopy, code: ImageInputError): string {
  return {
    image_count: copy.imageCountError,
    image_type: copy.imageTypeError,
    image_size: copy.imageSizeError,
    image_invalid: copy.imageInvalid
  }[code];
}

export function useImageSelection(
  copy: DesktopCopy,
  idle: boolean,
  announce: (value: string) => void
): {
  readonly images: readonly DesktopImage[];
  readonly error: string | null;
  readonly open: boolean;
  readonly setOpen: (value: boolean) => void;
  readonly choose: (files: readonly File[]) => Promise<void>;
  readonly remove: (index: number) => void;
  readonly invalidateAndClose: () => void;
} {
  const epoch = useRef(0);
  const [images, setImages] = useState<readonly DesktopImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const choose = async (files: readonly File[]) => {
    if (!idle) return;
    const request = ++epoch.current;
    const result = await readDesktopImages(files);
    if (request !== epoch.current) return;
    if (!result.ok) {
      const message = errorCopy(copy, result.code);
      setError(message);
      announce(message);
      return;
    }
    setImages(result.images);
    setError(null);
    setOpen(true);
    announce(formatCopy(copy.imagesReady, { count: result.images.length }));
  };
  const remove = (index: number) => {
    epoch.current += 1;
    const next = images.filter((_image, current) => current !== index);
    setImages(next);
    setError(null);
    if (!next.length) setOpen(false);
    announce(formatCopy(copy.imagesReady, { count: next.length }));
  };
  const invalidateAndClose = () => {
    epoch.current += 1;
    setOpen(false);
  };
  return { images, error, open, setOpen, choose, remove, invalidateAndClose };
}
