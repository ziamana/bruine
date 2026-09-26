export interface RateLimiterOptions {
  waitMs: number;
}

export type Scheduled = () => void;
