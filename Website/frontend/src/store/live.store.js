import { createStore } from './store.js'

// Store for live event data
const liveStore = createStore({
  events: [],
  lastUpdated: null,
  connected: false
})

export const liveActions = {
  setEvents: (events) => {
    liveStore.setState({
      events,
      lastUpdated: new Date().toISOString()
    })
  },

  addEvent: (event) => {
    const { events } = liveStore.getState()
    liveStore.setState({
      events: [...events, event],
      lastUpdated: new Date().toISOString()
    })
  },

  setConnected: (connected) => {
    liveStore.setState({ connected })
  }
}

export default liveStore
