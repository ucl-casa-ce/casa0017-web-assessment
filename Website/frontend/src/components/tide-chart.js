// Tide chart component

export function createTideChart(container) {
  const chartDiv = document.createElement('div')
  chartDiv.className = 'tide-chart'
  chartDiv.innerHTML = '<p>Tide chart will be rendered here</p>'
  container.appendChild(chartDiv)

  return {
    update: (data) => {
      console.log('Updating tide chart with:', data)
    },
    destroy: () => {
      chartDiv.remove()
    }
  }
}
