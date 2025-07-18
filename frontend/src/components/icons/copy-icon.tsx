/* Copyright 2024 Marimo. All rights reserved. */
import { CheckIcon, Copy } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { cn } from "@/utils/cn";
import { copyToClipboard } from "@/utils/copy";
import { Events } from "@/utils/events";
import { Tooltip } from "../ui/tooltip";
import { toast } from "../ui/use-toast";

interface Props {
  value: string | (() => string);
  className?: string;
  tooltip?: string | false;
  toastTitle?: string;
}

export const CopyClipboardIcon: React.FC<Props> = ({
  value,
  className,
  tooltip,
  toastTitle,
}) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = Events.stopPropagation(async () => {
    const valueToCopy = typeof value === "function" ? value() : value;
    await copyToClipboard(valueToCopy).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      if (toastTitle) {
        toast({ title: toastTitle });
      }
    });
  });

  const button = (
    <button type="button" onClick={handleCopy} aria-label="Copy to clipboard">
      {isCopied ? (
        <CheckIcon className={cn(className, "text-[var(--grass-11)]")} />
      ) : (
        <Copy className={className} />
      )}
    </button>
  );

  if (tooltip === false) {
    return button;
  }

  return (
    <Tooltip
      content={isCopied ? "Copied!" : (tooltip ?? "Copy to clipboard")}
      delayDuration={400}
    >
      {button}
    </Tooltip>
  );
};
