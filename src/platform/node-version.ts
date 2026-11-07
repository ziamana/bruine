/** The oldest Node bruine runs on: dsh 0.2 asks for 24.9 (its session store uses node:sqlite). */
export const MIN_NODE = { major: 24, minor: 9 } as const;

/** Is this Node version (`process.versions.node`, e.g. "24.9.0") new enough? */
export function nodeIsSupported(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor);
}

/** What bruine says before it stops on an older Node, and the way back to the 0.1 line. */
export function oldNodeMessage(bruineVersion: string, nodeVersion: string): string {
  return (
    `bruine ${bruineVersion} needs Node ${MIN_NODE.major}.${MIN_NODE.minor} or newer; this is Node ${nodeVersion}.\n` +
    "Update Node (https://nodejs.org), or keep bruine 0.1, which runs on Node 22: npm install -g @ziamana/bruine@0.1"
  );
}
