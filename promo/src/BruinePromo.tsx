import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, COPY, sceneFrames, type Lang } from "./config";
import { Backdrop, Rain } from "./components/Rain";
import { Intro } from "./scenes/Intro";
import { Models } from "./scenes/Models";
import { Demo } from "./scenes/Demo";
import { Effort } from "./scenes/Effort";
import { Promises } from "./scenes/Promises";
import { Outro } from "./scenes/Outro";
import { sec } from "./lib/motion";

export type PromoProps = { lang: Lang };

/** The night comes in at the start and takes the frame back at the end. */
const Night: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, sec(0.5), durationInFrames - sec(0.9), durationInFrames - 1], [1, 0, 0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ background: COLORS.night, opacity }} />;
};

/**
 * Bruine in about forty seconds: the name, the mark, any model, a real session, the rain that
 * follows the effort, three promises, and the two commands that start it. One rain falls under
 * all of it, so the scenes read as one take.
 */
export const BruinePromo: React.FC<PromoProps> = ({ lang }) => {
  const copy = COPY[lang] ?? COPY.en;
  const s = sceneFrames();
  return (
    <AbsoluteFill style={{ background: COLORS.night }}>
      <Backdrop />
      <Rain />
      <Sequence from={s.intro.from} durationInFrames={s.intro.duration} name="Intro">
        <Intro copy={copy.intro} />
      </Sequence>
      <Sequence from={s.models.from} durationInFrames={s.models.duration} name="Models">
        <Models copy={copy.models} />
      </Sequence>
      <Sequence from={s.demo.from} durationInFrames={s.demo.duration} name="Demo">
        <Demo copy={copy.demo} />
      </Sequence>
      <Sequence from={s.effort.from} durationInFrames={s.effort.duration} name="Effort">
        <Effort copy={copy.effort} />
      </Sequence>
      <Sequence from={s.promises.from} durationInFrames={s.promises.duration} name="Promises">
        <Promises copy={copy.promises} />
      </Sequence>
      <Sequence from={s.outro.from} durationInFrames={s.outro.duration} name="Outro">
        <Outro copy={copy.outro} />
      </Sequence>
      <Night />
    </AbsoluteFill>
  );
};
