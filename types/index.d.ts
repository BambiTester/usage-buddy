/** One usage window: which one, how much is used (0 to 100), when it resets. */
export type Window = { kind: string; percentUsed: number; resetsAt?: string }

/** The prompt cache as last seen: last request time (clock ms), context tokens, context window, model. */
export type CacheFacts = { lastAt: number; tokens: number; window: number; model: string | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-buddy': {
      windows: Window[]
      cache: CacheFacts | null
      // When a request last broke a cold cache (clock ms); 0 when never.
      thawAt: number
    }
  }
}
