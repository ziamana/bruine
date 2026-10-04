import { createContext, useContext } from "react";
import type { CutName } from "./config";

/** Which film is being drawn: the backdrop (rain, lightning, ripples) follows that cut's timeline. */
export const CutContext = createContext<CutName>("full");
export const useCut = (): CutName => useContext(CutContext);
