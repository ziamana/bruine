import React from "react";
import { Composition } from "remotion";
import { BruinePromo, type PromoProps } from "./BruinePromo";
import { totalFrames, VIDEO } from "./config";

export const RemotionRoot: React.FC = () => (
  <Composition
    id={VIDEO.id}
    component={BruinePromo}
    durationInFrames={totalFrames()}
    fps={VIDEO.fps}
    width={VIDEO.width}
    height={VIDEO.height}
    defaultProps={{ lang: "en" } satisfies PromoProps}
  />
);
