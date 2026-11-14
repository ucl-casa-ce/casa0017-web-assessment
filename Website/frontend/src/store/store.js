// Tiny observable store factory

export function createStore(initialState = {}) {
  let state = { ...initialState }
  const listeners = new Set()

  return {
    getState: () => state,

    setState: (updates) => {
      state = { ...state, ...updates }
      listeners.forEach(listener => listener(state))
    },

    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    notify: () => {
      listeners.forEach(listener => listener(state))
    }
  }
}
