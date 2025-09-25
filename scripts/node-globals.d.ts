declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
};

declare const console: {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};
