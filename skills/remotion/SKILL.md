---
name: remotion
description: Create videos and motion design with Remotion and React: animated titles, transitions, compositions, previews, and exports.
---

# Remotion motion design

Use this skill when the user wants a video, animated title, motion graphic, or a Remotion composition.

## Start with the project

- Inspect the existing project, package scripts, Remotion version, compositions, and assets. Preserve the user's edits and match the project's conventions.
- For a new project, read the current official creation guide before scaffolding. Ask only for missing choices that materially affect the video, such as aspect ratio, duration, or intended audience.
- Reuse supplied images, fonts, logos, and audio. Make deliberate choices for typography, hierarchy, pacing, and transitions.

## Build the animation

- Read the relevant official documentation before choosing APIs or installing packages. Use the version already installed when a project exists.
- Drive animation from Remotion's frame clock. Use frame-based interpolation or springs so seeking and rendering produce the same result.
- Keep duration, frame rate, and composition dimensions explicit. Use sequences to organize scenes and reusable React components for repeated visuals.
- Avoid wall-clock timers, nondeterministic randomness, and CSS animations for rendered motion. Seed any procedural effects.
- Keep text readable, respect safe margins, and test long copy. Balance quiet holds with motion; avoid making every element move at once.
- Load assets and fonts using the supported Remotion APIs. Verify their availability before rendering and handle asynchronous loading correctly.

## Preview and deliver

- Start Remotion Studio using the project's existing script or local CLI. Open the preview when browser tools are available.
- Inspect scene boundaries, the first and last frames, typography, cropping, audio synchronization, and motion at multiple playback positions.
- Run the project's relevant checks. Fix visual or timing issues before claiming the video is ready.
- Render a video or still when the user requests an export. Confirm the resulting file exists and give its path, dimensions, duration, and format.
- Do not install extra tools or render a full video merely to explain an idea.

## Official references

- [Remotion documentation](https://www.remotion.dev/docs/)
- [Creating a project](https://www.remotion.dev/docs/)
- [Animation fundamentals](https://www.remotion.dev/docs/animating-properties)
- [Remotion Studio](https://www.remotion.dev/docs/preview)
- [Rendering](https://www.remotion.dev/docs/render)
- [Official agent skills](https://www.remotion.dev/docs/ai/skills)

This is Bruine's own optional guide. The upstream agent skill collection is maintained at `remotion-dev/skills`; consult it when a task requires more specialized guidance.
