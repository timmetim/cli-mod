import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Entry, Layout } from '../types'

const cwd$ = atom({ plugin: 'cli-mod', key: 'cwd' } as const, '')
const entries$ = atom({ plugin: 'cli-mod', key: 'entries' } as const, [] as Entry[])
const selected$ = atom({ plugin: 'cli-mod', key: 'selected' } as const, null as string | null)
const content$ = atom({ plugin: 'cli-mod', key: 'content' } as const, '')
const diff$ = atom({ plugin: 'cli-mod', key: 'diff' } as const, '')
const layout$ = atom({ plugin: 'cli-mod', key: 'layout' } as const, { col: 35, row: 60 } as Layout)
const page$ = atom({ plugin: 'cli-mod', key: 'page' } as const, 0)
const scroll$ = atom({ plugin: 'cli-mod', key: 'scroll' } as const, 0)

const PANE = 'cli-mod'

const LANGS: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rs: 'rust', go: 'go', json: 'json', yaml: 'yaml',
  yml: 'yaml', toml: 'toml', css: 'css', html: 'html', xml: 'xml',
  sh: 'bash', md: 'markdown', sql: 'sql', c: 'c', cpp: 'cpp',
  h: 'c', rb: 'ruby', swift: 'swift', kt: 'kotlin', java: 'java',
}

async function loadDir($: any, dir: string) {
  try {
    const raw = await $.fs.list(dir)
    const sorted = [...raw]
      .filter((e: any) => e.kind !== 'other')
      .sort((a: any, b: any) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    await update($, entries$, () =>
      sorted.map((e: any) => ({ name: e.name, isDir: e.kind === 'dir' })),
    )
    await update($, cwd$, () => dir)
    await update($, page$, () => 0)
  } catch { /* dir unreadable */ }
}

async function loadFile($: any, path: string) {
  try {
    const text = await $.fs.read(path)
    await update($, content$, () => text)
    await update($, selected$, () => path)
    await update($, scroll$, () => 0)
  } catch {
    await update($, content$, () => '(cannot read)')
    await update($, selected$, () => path)
  }
}

async function loadDiff($: any) {
  try {
    const r = await $.process.run(['git', 'diff', '--no-color'])
    await update($, diff$, () => r.stdout || '')
  } catch {
    await update($, diff$, () => '')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'browse',
      description: 'File browser + editor + diff pane',
    })
    const stored = await $.store.get('cli-mod:layout')
    if (stored && typeof stored === 'object') {
      await update($, layout$, () => stored as Layout)
    }
    return next(e)
  })

  on('command.run', { command: 'browse' }, async $ => {
    const dir = await $.session.cwd()
    await loadDir($, dir)
    await loadDiff($)
    await $.ui.open({ id: PANE, title: 'Browse', focus: true, closeOnEscape: true, columns: 100 })
    return { text: 'File browser opened.' }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const r = await next(e)
    await loadDiff($)
    const sel = await read($, selected$)
    if (sel && sel === (e as any).file_path) await loadFile($, sel)
    return r
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const r = await next(e)
    await loadDiff($)
    const sel = await read($, selected$)
    if (sel && sel === (e as any).file_path) await loadFile($, sel)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)

    const dir = await read($, cwd$)
    if (!dir) return <Box><Text dimColor>Run /browse to open</Text></Box>

    const all = await read($, entries$)
    const sel = await read($, selected$)
    const content = await read($, content$)
    const gitDiff = await read($, diff$)
    const lay = await read($, layout$)
    const pg = await read($, page$)
    const sc = await read($, scroll$)

    const cols = e.props?.bodyColumns ?? 80
    const rows = (e.viewport?.rows ?? 24) - 2
    const leftW = Math.max(24, Math.min(cols - 30, Math.floor(cols * lay.col / 100)))

    const perPage = 9
    const start = pg * perPage
    const visible = all.slice(start, start + perPage)
    const pages = Math.max(1, Math.ceil(all.length / perPage))

    const ext = sel?.split('.').pop() ?? ''
    const lines = content ? content.split('\n') : []
    const viewH = Math.max(1, rows - 4)
    const maxSc = Math.max(0, lines.length - viewH)
    const shown = lines.slice(sc, sc + viewH).join('\n')

    const hasDiff = gitDiff.length > 0 && gitDiff.includes('@@')

    return (
      <Box flexDirection="column">
        {/* Main area: two columns */}
        <Box flexDirection="row" flexGrow={1}>
          {/* Left column: files on top, diff below */}
          <Box flexDirection="column" width={leftW}>
            {/* File browser */}
            <Box flexDirection="column" borderStyle="round">
              <Text bold color="cyan">{dir}</Text>
              <Button key="up" hotkey="0" variant="plain" onPress={async () => {
                const parent = dir.replace(/\/[^/]+\/?$/, '') || '/'
                await loadDir($, parent)
                await loadDiff($)
              }}>../</Button>
              {visible.map((entry, i) => (
                <Button key={'e' + String(i)} hotkey={String(i + 1)} variant="plain" onPress={async () => {
                  const path = (dir === '/' ? '' : dir) + '/' + entry.name
                  if (entry.isDir) await loadDir($, path)
                  else await loadFile($, path)
                }}>{(entry.isDir ? '/' : ' ') + entry.name}</Button>
              ))}
              <Text dimColor>pg {pg + 1}/{pages} ({all.length})</Text>
            </Box>
            {/* Diff */}
            <Box flexDirection="column" flexGrow={1} borderStyle="round">
              <Text bold color="yellow">diff</Text>
              {hasDiff
                ? <Code source={gitDiff.slice(0, 6000)} format="diff" />
                : <Text dimColor>clean</Text>
              }
            </Box>
          </Box>

          {/* Right column: file viewer */}
          <Box flexDirection="column" flexGrow={1} borderStyle="round">
            <Text bold color="green">{sel ? sel.split('/').pop() : '(none)'}</Text>
            {sel && <Text dimColor>L{sc + 1}-{Math.min(sc + viewH, lines.length)}/{lines.length}</Text>}
            {content
              ? <Code source={shown} language={LANGS[ext] ?? ''} startLine={sc + 1} />
              : <Text dimColor>Select a file (1-9)</Text>
            }
          </Box>
        </Box>

        {/* Bottom bar */}
        <Box flexDirection="row">
          <Button key="bp" hotkey="p" variant="plain" onPress={async () => {
            await update($, page$, p => Math.max(0, p - 1))
          }}>prev</Button>
          <Text> </Text>
          <Button key="bn" hotkey="n" variant="plain" onPress={async () => {
            await update($, page$, p => Math.min(pages - 1, p + 1))
          }}>next</Button>
          <Text> </Text>
          <Button key="br" hotkey="r" variant="plain" onPress={async () => {
            await loadDir($, dir)
            await loadDiff($)
            if (sel) await loadFile($, sel)
          }}>refresh</Button>
          <Text> </Text>
          <Button key="bw" hotkey="w" variant="plain" onPress={async () => {
            await update($, scroll$, s => Math.max(0, s - Math.floor(viewH / 2)))
          }}>pgup</Button>
          <Text> </Text>
          <Button key="bs" hotkey="s" variant="plain" onPress={async () => {
            await update($, scroll$, s => Math.min(maxSc, s + Math.floor(viewH / 2)))
          }}>pgdn</Button>
          <Text>  </Text>
          <Button key="bh" hotkey="h" variant="plain" onPress={async () => {
            await update($, layout$, l => ({ ...l, col: Math.max(15, l.col - 5) }))
            const l = await read($, layout$)
            await $.store.set('cli-mod:layout', l)
          }}>col-</Button>
          <Text> </Text>
          <Button key="bl" hotkey="l" variant="plain" onPress={async () => {
            await update($, layout$, l => ({ ...l, col: Math.min(70, l.col + 5) }))
            const l = await read($, layout$)
            await $.store.set('cli-mod:layout', l)
          }}>col+</Button>
        </Box>
      </Box>
    )
  })
}
