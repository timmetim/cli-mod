export type Entry = { name: string; isDir: boolean }
export type Layout = { col: number; row: number }

declare module 'claude-code' {
  interface PluginState {
    'cli-mod': {
      cwd: string
      entries: Entry[]
      selected: string | null
      content: string
      diff: string
      layout: Layout
      page: number
      scroll: number
    }
  }
}
