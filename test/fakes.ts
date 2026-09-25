import type { Screen } from "../src/render/reasoning.js";

export class FakeScreen implements Screen {
  writes: string[] = [];
  columns = 80;
  write(s: string): void {
    this.writes.push(s);
  }
  get last(): string {
    return this.writes[this.writes.length - 1] ?? "";
  }
  get all(): string {
    return this.writes.join("");
  }
}

export const strip = (s: string): string =>
  s.replace(/\r/g, "").replace(/\x1b\[[0-9]*[A-Za-z]/g, "");

export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
} {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export const tick = (): Promise<void> =>
  new Promise((r) => {
    setImmediate(r);
  });

export interface FakeEventCtx {
  ctx: {
    on(event: string, listener: (...args: any[]) => any): () => void;
    provide(name: string, value: unknown): void;
    inject(services: string[], cb: (ctx: any) => void): void;
    get(service: string): any;
  };
  emit(event: string, ...args: any[]): any;
  provided: Map<string, unknown>;
  injected: Array<{ services: string[]; cb: (ctx: any) => void }>;
}

/** A fake Cordis context: records listeners, provides, and injects. */
export function fakeCtx(services: Record<string, unknown> = {}): FakeEventCtx {
  const listeners = new Map<string, Array<(...args: any[]) => any>>();
  const provided = new Map<string, unknown>();
  const injected: Array<{ services: string[]; cb: (ctx: any) => void }> = [];
  return {
    ctx: {
      on(event, listener) {
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
        return () => {
          const i = list.indexOf(listener);
          if (i !== -1) list.splice(i, 1);
        };
      },
      provide(name, value) {
        provided.set(name, value);
      },
      inject(serviceNames, cb) {
        injected.push({ services: serviceNames, cb });
      },
      get(service) {
        return provided.get(service) ?? services[service];
      },
    },
    emit(event, ...args) {
      const results: any[] = [];
      for (const listener of listeners.get(event) ?? []) results.push(listener(...args));
      return results.length === 1 ? results[0] : results;
    },
    provided,
    injected,
  };
}

/** Run pending inject callbacks as if every service just appeared. */
export function flushInjects(
  fake: FakeEventCtx,
  available: Record<string, unknown>,
): void {
  for (const { services, cb } of fake.injected) {
    if (services.every((s) => s in available)) cb(available);
  }
}
