/** The page's sky: how hard it rains (0 to 1), whether it holds still, and rings where something landed. */
export interface Weather {
  intensity: number;
  still?: boolean;
  lightning?: boolean;
}

const WEATHER = "bruine:weather";
const RIPPLE = "bruine:ripple";
export const BASE_INTENSITY = 0.16;

export const setWeather = (weather: Weather): void => {
  window.dispatchEvent(new CustomEvent<Weather>(WEATHER, { detail: weather }));
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
