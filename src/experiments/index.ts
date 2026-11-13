import { emitExperimentsUpdate } from '../core/hmr.ts'
import type { Experiment } from '../core/types.ts'

// Авторегистрация: каждая папка с index.ts — эксперимент, id = имя папки.
const modules = import.meta.glob<{ default: Experiment }>('./*/index.ts', { eager: true })

export const experiments: Record<string, Experiment> = Object.fromEntries(
  Object.entries(modules)
    .map(([path, m]) => [path.split('/')[1], m.default] as const)
    .sort(([a], [b]) => a.localeCompare(b)),
)

if (import.meta.hot) {
  import.meta.hot.accept((m) => m && emitExperimentsUpdate(m.experiments))
}
