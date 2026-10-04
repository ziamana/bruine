import React from "react";
import { Composition } from "remotion";
import { BruinePromo, type PromoProps } from "./BruinePromo";
import { CUTS, totalFrames, VIDEO, type CutName } from "./config";
import "./fonts";

/** The full presentation and its fifteen-second cut: the same scenes, the same rain. */
export const RemotionRoot: React.FC = () => (
  <>
    {(Object.keys(CUTS) as CutName[]).map((cut) => (
      <Composition
        key={cut}
        id={CUTS[cut].id}
        component={BruinePromo}
        durationInFrames={totalFrames(cut)}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
        defaultProps={{ lang: "en", cut } satisfies PromoProps}
      />
    ))}
  </>
);
