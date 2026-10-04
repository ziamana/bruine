/** The page's sky: how hard it rains (0 to 1), whether it holds still, and rings where something landed. */
export interface Weather {
  intensity: number;
  still?: boolean;
  lightning?: boolean;
}

const WEATHER = "bruine:weather";
const RIPPLE = "bruine:ripple";
export const BASE_INTENSITY = 0.16;

/**
 * Several parts of the page ask for weather (the session holds the rain still during an approval,
 * the weather card brings the storm): each claims it under its own name, and the sky takes the
 * strongest rain, lightning if anyone asks, and stillness if anyone waits.
 */
const claims = new Map<string, Weather>();
export const setWeather = (source: string, weather: Weather | null): void => {
  if (weather) claims.set(source, weather);
  else claims.delete(source);
  const all = [...claims.values()];
  const sky: Weather = {
    intensity: Math.max(BASE_INTENSITY, ...all.map((w) => w.intensity)),
    lightning: all.some((w) => w.lightning),
    still: all.some((w) => w.still),
  };
  window.dispatchEvent(new CustomEvent<Weather>(WEATHER, { detail: sky }));
};
export const onWeather = (listener: (weather: Weather) => void): (() => void) => {
  const handler = (event: Event): void => listener((event as CustomEvent<Weather>).detail);
  window.addEventListener(WEATHER, handler);
  return () => window.removeEventListener(WEATHER, handler);
};

export const ripple = (x: number, y: number): void => {
  window.dispatchEvent(new CustomEvent(RIPPLE, { detail: { x, y } }));
};
export const onRipple = (listener: (at: { x: number; y: number }) => void): (() => void) => {
  const handler = (event: Event): void => listener((event as CustomEvent<{ x: number; y: number }>).detail);
  window.addEventListener(RIPPLE, handler);
  return () => window.removeEventListener(RIPPLE, handler);
};
