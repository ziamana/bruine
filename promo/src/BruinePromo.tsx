import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, COPY, RIPPLE_ORIGIN, SCENE_ORDER, type Lang, type SceneName } from "./config";
import { Backdrop, Rain, RainFront } from "./components/Rain";
import { Fog, Grain, LightningSky, LightningWash, SceneShell, TransitionRings, Vignette } from "./components/Atmosphere";
import { Intro } from "./scenes/Intro";
import { Models } from "./scenes/Models";
import { Demo } from "./scenes/Demo";
import { Effort } from "./scenes/Effort";
import { Promises } from "./scenes/Promises";
import { Outro } from "./scenes/Outro";
import { SCENES, sec } from "./timeline.ts";

export type PromoProps = { lang: Lang };

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
export const BruinePromo: React.FC<PromoProps> = ({ lang }) => {
  const copy = COPY[lang] ?? COPY.en;
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
    <AbsoluteFill style={{ background: COLORS.night }}>
      <Audio src={staticFile(`soundtrack-${lang}.wav`)} />
      <Backdrop />
      <LightningSky />
      <Fog />
      <Rain />
      {SCENE_ORDER.map((name, i) => {
        const next = SCENE_ORDER[i + 1];
        return (
          <Sequence key={name} from={SCENES[name].from} durationInFrames={SCENES[name].duration} name={name}>
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
  );
};
