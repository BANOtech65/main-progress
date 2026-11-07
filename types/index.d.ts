export type Flow = {
  title: string
  total: number
  done: number
  note: string
  isFinished: boolean
  /** Statuses mirrored from the task list, when there is one. */
  steps: ('pending' | 'in_progress' | 'completed')[]
  labels: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'main-progress': {
      flow: Flow | null
      isWorking: boolean
    }
  }
}
