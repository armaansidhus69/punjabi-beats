export type ErrorContext = Record<string, string | number | boolean | null>;
export type ErrorReporter = (error: unknown, context?: ErrorContext) => void;

let reporter: ErrorReporter | null = null;

export function configureErrorReporting(nextReporter: ErrorReporter | null = null): void {
  reporter = nextReporter;
}

export function reportError(error: unknown, context?: ErrorContext): void {
  if (!reporter) return;
  try {
    reporter(error, context);
  } catch {
    // Error reporting must never become a second app failure.
  }
}
