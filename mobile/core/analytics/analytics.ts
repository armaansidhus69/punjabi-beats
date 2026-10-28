export interface AnalyticsEvent {
  name: string;
  properties?: Record<string, string | number | boolean | null>;
  timestamp?: number;
}

export type AnalyticsSink = (event: AnalyticsEvent) => void;

let enabled = false;
let sink: AnalyticsSink | null = null;

export function configureAnalytics(options: { enabled?: boolean; sink?: AnalyticsSink | null } = {}): void {
  enabled = options.enabled === true;
  sink = options.sink ?? null;
}

export function trackEvent(
  name: string,
  properties?: Record<string, string | number | boolean | null>,
): void {
  if (!enabled || !sink) return;
  sink({ name, properties, timestamp: Date.now() });
}

export function setAnalyticsUser(_userId: string | null): void {
  // Provider-specific user binding will be added with authenticated accounts.
}
