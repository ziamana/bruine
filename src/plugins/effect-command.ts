import { WEATHER_EFFECTS, parseWeatherEffect, saveWeatherEffect, type WeatherEffect } from "../ui/weather-effect.js";

export interface EffectUi {
  effect: WeatherEffect;
  setEffect(effect: WeatherEffect): void;
  askChoice(title: string, items: Array<{ value: string; label: string; description?: string }>, opts?: { initial?: number; preview?: (index: number) => void }): Promise<number>;
}

/** Local UI command: no message or request is sent to the model. */
export async function runEffectCommand(argument: string, ui: EffectUi | undefined, home: string): Promise<string> {
  if (ui === undefined) return "/effect needs the terminal UI.";
  const previous = ui.effect;
  let selected: WeatherEffect | undefined;
  if (argument.trim() === "") {
    try {
      const index = await ui.askChoice("Weather effect", WEATHER_EFFECTS, {
        initial: WEATHER_EFFECTS.findIndex((effect) => effect.value === previous),
        preview: (index) => { const effect = WEATHER_EFFECTS[index]; if (effect !== undefined) ui.setEffect(effect.value); },
      });
      selected = WEATHER_EFFECTS[index]?.value;
    } finally { ui.setEffect(previous); }
    if (selected === undefined) return `Weather unchanged: ${previous}.`;
  } else {
    selected = parseWeatherEffect(argument);
    if (selected === undefined) return "Usage: /effect bruine|pluie|foudre|auto|on|off";
  }
  try {
    await saveWeatherEffect(home, selected);
  } catch {
    return "Could not save the weather effect; previous effect kept.";
  }
  ui.setEffect(selected);
  return `Weather: ${selected}.`;
}
