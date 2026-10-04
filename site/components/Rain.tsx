"use client";

import { useEffect, useRef } from "react";
import { BASE_INTENSITY, onRipple, onWeather, type Weather } from "@/lib/weather";

/** The TUI's rain colours: sky, lavender, pink, and a pale blue for the faint drops. */
const INKS = ["125,207,255", "180,167,255", "255,158,210", "200,214,255"];
const MAX_DROPS = 340;

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  ink: string;
  alpha: number;
}
interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  ink: string;
}

const spawn = (w: number, h: number, anywhere: boolean): Drop => ({
  x: Math.random() * w,
  y: anywhere ? Math.random() * h : -40 - Math.random() * h * 0.3,
  len: 8 + Math.random() * 22,
  speed: 0.35 + Math.random() * 0.75,
  ink: INKS[Math.floor(Math.random() * INKS.length)]!,
  alpha: 0.12 + Math.random() * 0.4,
});

/**
 * Rain behind the page, as in the terminal: a drizzle at rest, a storm at max effort, still while
 * bruine waits for you. Nothing moves for a visitor who asked for reduced motion.
 */
export function Rain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const flash = flashRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !flash || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const drops: Drop[] = Array.from({ length: MAX_DROPS }, () => spawn(w, h, true));
    const rings: Ring[] = [];
    let weather: Weather = { intensity: BASE_INTENSITY };
    let level = BASE_INTENSITY;
    let last = performance.now();
    let frame = 0;
    let nextBolt = 0;

    const draw = (dt: number): void => {
      ctx.clearRect(0, 0, w, h);
      const density = Math.min(1, w / 1440) * 0.6 + 0.4;
      const count = Math.round(MAX_DROPS * density * (0.12 + 0.88 * level));
      const speedUp = 0.55 + level * 1.6;
      const slant = 0.06 + level * 0.12;
      ctx.lineCap = "round";
      for (let i = 0; i < count; i += 1) {
        const d = drops[i]!;
        if (!weather.still && dt > 0) {
          d.y += d.speed * speedUp * dt;
          d.x += d.speed * speedUp * dt * slant;
          if (d.y - d.len > h) {
            if (level > 0.45 && rings.length < 14 && Math.random() < 0.05 * level) rings.push({ x: d.x, y: h - 6 - Math.random() * h * 0.25, r: 1, life: 1, ink: d.ink });
            Object.assign(d, spawn(w, h, false));
          }
          if (d.x > w + 20) d.x -= w + 40;
        }
        ctx.strokeStyle = `rgba(${d.ink},${d.alpha * (0.55 + level * 0.45)})`;
        ctx.lineWidth = d.len > 22 ? 1.2 : 1;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * slant, d.y - d.len);
        ctx.stroke();
      }
      for (let i = rings.length - 1; i >= 0; i -= 1) {
        const ring = rings[i]!;
        if (dt > 0) {
          ring.r += dt * 0.03;
          ring.life -= dt * 0.0016;
        }
        if (ring.life <= 0) {
          rings.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = `rgba(${ring.ink},${ring.life * 0.45})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(ring.x, ring.y, ring.r * 2.4, ring.r * 0.7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const tick = (now: number): void => {
      const dt = Math.min(48, now - last);
      last = now;
      level += (weather.intensity - level) * Math.min(1, dt / 420);
      draw(dt);
      if (weather.lightning && now > nextBolt) {
        nextBolt = now + 1800 + Math.random() * 2600;
        flash.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.08 }, { opacity: 0.1, offset: 0.3 }, { opacity: 0.38, offset: 0.42 }, { opacity: 0 }], {
          duration: 900,
          easing: "ease-out",
        });
      }
      frame = requestAnimationFrame(tick);
    };

    const offWeather = onWeather((next) => {
      weather = next;
    });
    const offRipple = onRipple(({ x, y }) => {
      for (let k = 0; k < 3; k += 1) rings.push({ x, y, r: 2 + k * 6, life: 1 - k * 0.22, ink: INKS[1]! });
      if (reduced) draw(0);
    });
    const onResize = (): void => {
      resize();
      if (reduced) draw(0);
    };
    const onVisibility = (): void => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !reduced) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    if (reduced) draw(0);
    else frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      offWeather();
      offRipple();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="rain" aria-hidden="true" />
      <div ref={flashRef} className="lightning" aria-hidden="true" />
    </>
  );
}
