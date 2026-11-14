import { createStore } from './store.js'

// Store for outfall data
const outfallsStore = createStore({
  outfalls: [],
  loading: false,
  error: null,
  selectedOutfall: null
})

export const outfallsActions = {
  setOutfalls: (outfalls) => {
    outfallsStore.setState({ outfalls, loading: false, error: null })
  },

  setLoading: (loading) => {
    outfallsStore.setState({ loading })
  },

  setError: (error) => {
    outfallsStore.setState({ error, loading: false })
  },

  selectOutfall: (outfall) => {
    outfallsStore.setState({ selectedOutfall: outfall })
  }
}

export default outfallsStore
