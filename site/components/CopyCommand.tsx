"use client";

import { useState } from "react";

/** A command to copy, the way the band shows it: a prompt sign and a button that says what happened. */
export function CopyCommand({ command, copy, copied }: { command: string; copy: string; copied: string }) {
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setDone(true);
      setFailed(false);
      window.setTimeout(() => setDone(false), 2200);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="copy-command" data-failed={failed}>
      <pre>
        <code translate="no">{command}</code>
      </pre>
      <button type="button" onClick={() => void onCopy()} aria-live="polite">
        {done ? copied : copy}
      </button>
    </div>
  );
}
