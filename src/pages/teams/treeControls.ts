import { useEffect } from 'react'

// A tiny module-scoped bridge so the Network tab can drive fit / centre /
// zoom on the single mounted <NetworkTree> without threading a ref type
// through every render. Only one tree is ever mounted at a time.
export interface NetworkTreeHandle {
  fit: () => void
  centreOn: (id: string) => void
  zoomBy: (factor: number) => void
}

let current: NetworkTreeHandle | null = null

export function useRegisterTreeControls(handle: NetworkTreeHandle) {
  useEffect(() => {
    current = handle
    return () => {
      if (current === handle) current = null
    }
  }, [handle])
}

export function treeControls(): NetworkTreeHandle | null {
  return current
}
