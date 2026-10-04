import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, COPY, CUTS, RIPPLE_ORIGIN, type CutName, type Lang, type SceneName } from "./config";
import { CutContext } from "./cut";
import { Backdrop, Rain, RainFront } from "./components/Rain";
import { Fog, Grain, LightningSky, LightningWash, SceneShell, TransitionRings, Vignette } from "./components/Atmosphere";
import { Intro } from "./scenes/Intro";
import { Models } from "./scenes/Models";
import { Demo } from "./scenes/Demo";
import { Effort } from "./scenes/Effort";
import { Promises } from "./scenes/Promises";
import { Outro } from "./scenes/Outro";
import { scenesOf, sec } from "./timeline.ts";

export type PromoProps = { lang: Lang; cut?: CutName };

/** The night comes in at the start and takes the frame back at the end. */
const Night: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, sec(0.3), durationInFrames - sec(0.9), durationInFrames - 1], [1, 0, 0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ background: COLORS.night, opacity }} />;
};

/**
 * Bruine in about forty seconds: the name, the mark, any model, a real session, the rain that
 * follows the effort, three promises, and the two commands that start it. One rain falls under
 * all of it and a drop opens every scene, so the film reads as one take. The soundtrack is
 * synthesized from the same timeline (scripts/soundtrack.ts).
 */
export const BruinePromo: React.FC<PromoProps> = ({ lang, cut = "full" }) => {
  const copy = COPY[lang] ?? COPY.en;
  const scenes = scenesOf(cut);
  const order = CUTS[cut].order;
  const scene = (name: SceneName): React.ReactNode => {
    switch (name) {
      case "intro":
        return <Intro copy={copy.intro} />;
      case "models":
        return <Models copy={copy.models} />;
      case "demo":
        return <Demo copy={copy.demo} />;
      case "effort":
        return <Effort copy={copy.effort} />;
      case "promises":
        return <Promises copy={copy.promises} />;
      case "outro":
        return <Outro copy={copy.outro} />;
    }
  };
  return (
    <CutContext.Provider value={cut}>
    <AbsoluteFill style={{ background: COLORS.night }}>
      <Audio src={staticFile(cut === "full" ? `soundtrack-${lang}.wav` : `soundtrack-${cut}-${lang}.wav`)} />
      <Backdrop />
      <LightningSky />
      <Fog />
      <Rain />
      {order.map((name, i) => {
        const next = order[i + 1];
        return (
          <Sequence key={name} from={scenes[name].from} durationInFrames={scenes[name].duration} name={name}>
            <SceneShell enter={i === 0 ? undefined : RIPPLE_ORIGIN[name]} exit={next === undefined ? undefined : RIPPLE_ORIGIN[next]}>
              {scene(name)}
            </SceneShell>
          </Sequence>
        );
      })}
      <TransitionRings />
      <RainFront />
      <LightningWash />
      <Vignette />
      <Grain />
      <Night />
    </AbsoluteFill>
    </CutContext.Provider>
  );
};
