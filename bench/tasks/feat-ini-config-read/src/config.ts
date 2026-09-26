/** The settings the app needs at startup. */
export interface AppConfig {
  host: string;
  port: number;
  verbose: boolean;
}

export const DEFAULTS: AppConfig = { host: "127.0.0.1", port: 8080, verbose: false };
