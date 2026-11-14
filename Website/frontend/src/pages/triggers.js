/* global $, maplibregl */

import { LONDON_BOUNDARY, LEA_CATCHMENT } from '../data/london.js'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000') + '/api'

const LONDON_BBOX = '-0.52,51.28,0.35,51.70'
const EDGE_TOLERANCE_M = 250

const RIVER_NAMES = { lea: 'River Lea', thames: 'Thames and others' }
const ALL_OUTFALLS = {
  all: 'All London outfalls',
  lea: 'All River Lea outfalls',
  thames: 'All Thames and other outfalls',
}
const LEA_LABEL = /\bRiver (Lea|Lee)\b|Bow Creek/i

const RAIN_MAX_MM = 30
const HOURS_MAX = 20
const DEFAULT_RAIN_MM = 4
const WET_PRIOR_MM = 2
const TOP_ROWS = 5
const LOAD_ATTEMPTS = 3

const state = {
  events: [],
  sites: new Map(),
  river: 'all',
  wetOnly: false,
  site: 'all',
  maxRain: DEFAULT_RAIN_MM,
  showAll: false,
}

let map = null
let points = []

function formatMm(mm) {
  if (mm > 0 && mm < 0.05) {
    return 'under 0.1 mm'
  }
  return Number(mm.toFixed(1)) + ' mm'
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's')
}

function insidePolygon(point, polygon) {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x1, y1] = polygon[i]
    const [x2, y2] = polygon[j]
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) {
      inside = !inside
    }
  }
  return inside
}

function metresToEdge(point, polygon) {
  const kx = 111320 * Math.cos((51.5 * Math.PI) / 180)
  const ky = 110540
  const px = point[0] * kx
  const py = point[1] * ky
  let best = Infinity
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const ax = polygon[j][0] * kx
    const ay = polygon[j][1] * ky
    const dx = polygon[i][0] * kx - ax
    const dy = polygon[i][1] * ky - ay
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy))
  }
  return best
}

// The boundary is clipped to the river bank, so outfalls on the Thames sit just outside it
function inLondon(point) {
  return (
    insidePolygon(point, LONDON_BOUNDARY) || metresToEdge(point, LONDON_BOUNDARY) < EDGE_TOLERANCE_M
  )
}

// Tributaries such as Pymmes Brook flow into the Lea, so fall back on where they are
function riverOf(label, point) {
  if (LEA_LABEL.test(label)) {
    return 'lea'
  }
  if (/thames/i.test(label)) {
    return 'thames'
  }
  return insidePolygon(point, LEA_CATCHMENT) ? 'lea' : 'thames'
}

// Some sites have several overflow pipes, each with its own permit number
function siteKey(name, point) {
  return name.toUpperCase() + '|' + point[0].toFixed(4) + ',' + point[1].toFixed(4)
}

function filteredEvents(anySite) {
  return state.events.filter(function (e) {
    if (state.river !== 'all' && e.river !== state.river) {
      return false
    }
    if (state.wetOnly && !(e.priorRain >= WET_PRIOR_MM)) {
      return false
    }
    return anySite || state.site === 'all' || e.site === state.site
  })
}

function isSelected(e) {
  return state.maxRain >= RAIN_MAX_MM || e.rain24h <= state.maxRain
}

function summarise(events) {
  const bySite = new Map()
  events.forEach(function (e) {
    const row = bySite.get(e.site) || {
      site: e.site,
      name: e.name,
      river: e.river,
      spills: 0,
      selected: 0,
      lowestRain: Infinity,
    }
    row.spills = row.spills + 1
    row.selected = row.selected + (isSelected(e) ? 1 : 0)
    row.lowestRain = Math.min(row.lowestRain, e.rain24h)
    bySite.set(e.site, row)
  })
  return bySite
}

function drawScatter() {
  const canvas = document.getElementById('scatter-canvas')
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const ratio = window.devicePixelRatio || 1
  canvas.width = width * ratio
  canvas.height = height * ratio

  const ctx = canvas.getContext('2d')
  ctx.scale(ratio, ratio)
  ctx.clearRect(0, 0, width, height)

  const crowded = points.length > 1000
  const radius = crowded ? 2.5 : 4

  const xy = function (e) {
    return [
      Math.min(e.rain24h / RAIN_MAX_MM, 1) * width,
      height - Math.min(e.hours / HOURS_MAX, 1) * height,
    ]
  }

  ctx.fillStyle = crowded ? 'rgba(140, 154, 168, 0.3)' : 'rgba(150, 163, 176, 0.5)'
  points.forEach(function (e) {
    if (!isSelected(e)) {
      const [x, y] = xy(e)
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  })

  ctx.fillStyle = crowded ? 'rgba(233, 162, 59, 0.75)' : '#e9a23b'
  ctx.strokeStyle = 'rgba(58, 42, 16, 0.5)'
  ctx.lineWidth = crowded ? 0.5 : 1
  points.forEach(function (e) {
    if (isSelected(e)) {
      const [x, y] = xy(e)
      ctx.beginPath()
      ctx.arc(x, y, radius + 0.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  })
}

function updateSelection(events) {
  drawScatter()

  const width = (state.maxRain / RAIN_MAX_MM) * 100
  $('#selection-box')
    .css('width', width + '%')
    .toggleClass('flip', width > 60)

  const selected = events.filter(isSelected)
  $('#selection-title').text(
    state.maxRain >= RAIN_MAX_MM
      ? 'All ' + plural(selected.length, 'spill')
      : plural(selected.length, 'spill') + ' after ' + formatMm(state.maxRain) + ' of rain or less'
  )
  $('#scatter').attr(
    'aria-label',
    'Scatter chart of ' +
      plural(events.length, 'spill') +
      ', rain before each spill against how long it lasted. ' +
      selected.length +
      ' fall inside your selection.'
  )
}

function updateMap(bySite) {
  let withSelected = 0
  bySite.forEach(function (row) {
    withSelected = withSelected + (row.selected > 0 ? 1 : 0)
  })
  $('#map-count').text(withSelected + ' of ' + plural(bySite.size, 'outfall'))

  if (!map || !map.getSource('outfalls')) {
    return
  }

  // Keep the other sites on the map, greyed out, so another one can be clicked
  const mapRows = state.site === 'all' ? bySite : summarise(filteredEvents(true))
  const features = []
  mapRows.forEach(function (row) {
    const site = state.sites.get(row.site)
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: site.coordinates },
      properties: {
        key: site.key,
        name: site.name,
        pipes: site.pipes,
        spilling: site.isDischarging,
        spills: row.spills,
        selected: row.selected,
        dimmed: state.site !== 'all' && site.key !== state.site,
        lowestRain: row.lowestRain,
      },
    })
  })
  map.getSource('outfalls').setData({ type: 'FeatureCollection', features: features })
}

function rankSites(bySite) {
  return Array.from(bySite.values()).sort(function (a, b) {
    return a.lowestRain - b.lowestRain || b.spills - a.spills
  })
}

function updateRanking(bySite) {
  const rows = rankSites(bySite)

  const $body = $('#ranking-body').empty()
  if (rows.length === 0) {
    $body.append(
      $('<tr>').append(
        $('<td colspan="6" class="empty-message">').text('No spills match these filters.')
      )
    )
  }

  const shown = state.showAll ? rows : rows.slice(0, TOP_ROWS)
  shown.forEach(function (row, i) {
    const site = state.sites.get(row.site)
    const barWidth = Math.min(row.lowestRain / RAIN_MAX_MM, 1) * 100
    const $name = $('<td>').text(row.name)
    if (site.pipes > 1) {
      $name.append($('<span class="pipes">').text(site.pipes + ' overflow pipes'))
    }

    $('<tr>')
      .toggleClass('top-row', i === 0)
      .append($('<td>').text(i + 1))
      .append($name)
      .append($('<td>').text(RIVER_NAMES[row.river]))
      .append(
        $('<td>')
          .text(formatMm(row.lowestRain))
          .append(
            $('<span class="bar"><span class="bar-fill"></span></span>')
              .find('.bar-fill')
              .css('width', barWidth + '%')
              .end()
          )
      )
      .append($('<td>').text(row.spills))
      .append(
        $('<td>').append(
          $('<span class="badge">')
            .addClass(site.isDischarging ? 'badge-spilling' : 'badge-ok')
            .text(site.isDischarging ? 'Spilling now' : 'Not spilling')
        )
      )
      .appendTo($body)
  })

  $('#show-all')
    .toggle(rows.length > TOP_ROWS)
    .text(state.showAll ? 'Show top ' + TOP_ROWS : 'See all ' + rows.length + ' outfalls')
}

function updateStat(events, bySite) {
  if (events.length === 0) {
    $('#stat-number').text('-- mm').addClass('is-empty')
    $('#gauge-fill').css('height', 0)
    $('#stat-text').text('No spills match these filters.')
    return
  }

  const top = rankSites(bySite)[0]
  const lowest = events
    .filter(function (e) {
      return e.site === top.site && e.rain24h === top.lowestRain
    })
    .reduce(function (a, b) {
      return b.start > a.start ? b : a
    })
  const selected = events.filter(isSelected)
  let sitesInSelection = 0
  bySite.forEach(function (row) {
    sitesInSelection = sitesInSelection + (row.selected > 0 ? 1 : 0)
  })

  $('#stat-number').text(formatMm(lowest.rain24h)).removeClass('is-empty')
  $('#gauge-fill').css('height', Math.min(lowest.rain24h / RAIN_MAX_MM, 1) * 100 + '%')
  $('#stat-text').text(
    'At ' +
      lowest.name +
      ', ' +
      formatDate(lowest.start) +
      '. Your selection holds ' +
      plural(selected.length, 'spill') +
      ' from ' +
      plural(sitesInSelection, 'outfall') +
      '.'
  )
}

function render(newFilters) {
  const events = filteredEvents()
  const bySite = summarise(events)

  if (newFilters) {
    points = events
  }

  $('#scatter .empty-message')
    .text(state.events.length === 0 ? 'No spills recorded yet.' : 'No spills match these filters.')
    .toggle(events.length === 0)

  updateSelection(events)
  updateMap(bySite)
  updateRanking(bySite)
  updateStat(events, bySite)
}

function fillOutfallSelect() {
  const named = new Map()
  state.events.forEach(function (e) {
    if (state.river === 'all' || e.river === state.river) {
      named.set(e.site, e.name)
    }
  })

  const $select = $('#outfall-select')
  $select.find('option:not([value="all"])').remove()
  $select.find('option[value="all"]').text(ALL_OUTFALLS[state.river])

  Array.from(named.entries())
    .sort(function (a, b) {
      return a[1].localeCompare(b[1])
    })
    .forEach(function (entry) {
      $('<option>').val(entry[0]).text(entry[1]).appendTo($select)
    })
}

function visibleBounds() {
  const bounds = new maplibregl.LngLatBounds()
  summarise(filteredEvents()).forEach(function (row) {
    bounds.extend(state.sites.get(row.site).coordinates)
  })
  return bounds
}

function fitMap() {
  if (!map) {
    return
  }
  const bounds = visibleBounds()
  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, {
      padding: 40,
      maxZoom: 13,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
    })
  }
}

function startMap() {
  if (typeof maplibregl === 'undefined') {
    $('#map').addClass('map-error').text("The map couldn't load.")
    return
  }

  const bounds = visibleBounds()

  try {
    map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/positron',
      bounds: bounds.isEmpty() ? [-0.51, 51.29, 0.33, 51.69] : bounds,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
      cooperativeGestures: true,
    })
  } catch {
    $('#map').addClass('map-error').text("The map couldn't load.")
    return
  }

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

  map.on('load', function () {
    map.addSource('outfalls', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })

    map.addLayer({
      id: 'outfalls-quiet',
      type: 'circle',
      source: 'outfalls',
      filter: ['any', ['==', ['get', 'selected'], 0], ['get', 'dimmed']],
      paint: {
        'circle-radius': 3,
        'circle-color': '#a0acb8',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 0.5,
      },
    })

    map.addLayer({
      id: 'outfalls-selected',
      type: 'circle',
      source: 'outfalls',
      filter: ['all', ['>', ['get', 'selected'], 0], ['!', ['get', 'dimmed']]],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'selected']], 1, 3.5, 12, 10],
        'circle-color': '#e9a23b',
        'circle-opacity': 0.85,
        'circle-stroke-color': '#3a2a10',
        'circle-stroke-width': 0.75,
      },
    })

    map.addLayer({
      id: 'outfalls-spilling',
      type: 'circle',
      source: 'outfalls',
      filter: ['==', ['get', 'spilling'], true],
      paint: {
        'circle-radius': 12,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#0f1f33',
        'circle-stroke-width': 2,
      },
    })

    render(false)

    const popup = new maplibregl.Popup({ closeButton: false, offset: 10 })
    ;['outfalls-quiet', 'outfalls-selected'].forEach(function (layer) {
      map.on('mouseenter', layer, function (e) {
        map.getCanvas().style.cursor = 'pointer'
        const p = e.features[0].properties
        const lines = [$('<strong>').text(p.name)]
        if (p.pipes > 1) {
          lines.push($('<span>').text(p.pipes + ' overflow pipes'))
        }
        lines.push($('<span>').text(p.selected + ' of ' + plural(p.spills, 'spill') + ' selected'))
        lines.push($('<span>').text('Lowest rain: ' + formatMm(Number(p.lowestRain))))
        if (p.spilling) {
          lines.push($('<span class="popup-spilling">').text('Spilling now'))
        }
        lines.push(
          $('<span class="popup-hint">').text(
            p.key === state.site
              ? 'Click to show all outfalls again'
              : 'Click to show only this outfall'
          )
        )
        popup
          .setLngLat(e.features[0].geometry.coordinates)
          .setDOMContent($('<div class="popup">').append(lines)[0])
          .addTo(map)
      })
      map.on('mouseleave', layer, function () {
        map.getCanvas().style.cursor = ''
        popup.remove()
      })
      map.on('click', layer, function (e) {
        const key = e.features[0].properties.key
        popup.remove()
        selectSite(state.site === key ? 'all' : key)
      })
    })
  })
}

function showData(scatterResponse, geojsonResponse) {
  const permitToSite = new Map()

  geojsonResponse.features.forEach(function (f) {
    const point = f.geometry.coordinates
    if (!inLondon(point)) {
      return
    }
    const name = f.properties.locationName.trim().replace(/,$/, '')
    const key = siteKey(name, point)
    const site = state.sites.get(key) || {
      key: key,
      name: name,
      river: riverOf(f.properties.river, point),
      coordinates: point,
      pipes: 0,
      isDischarging: false,
    }
    site.pipes = site.pipes + 1
    site.isDischarging = site.isDischarging || f.properties.isDischarging
    state.sites.set(key, site)
    permitToSite.set(f.properties.permitNumber, site)
  })

  scatterResponse.data.forEach(function (row) {
    const site = permitToSite.get(row.permitNumber)
    if (!site) {
      return
    }
    state.events.push({
      site: site.key,
      name: site.name,
      river: site.river,
      rain24h: Number(row.rain24h),
      priorRain: row.rain48h === null ? null : Number(row.rain48h) - Number(row.rain24h),
      hours: Number(row.durationHours),
      start: row.startTime,
    })
  })

  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  $('#last-updated').text('Live, updated ' + time)

  fillOutfallSelect()
  render(true)
  startMap()
}

function showError() {
  $('#last-updated').text('Live data unavailable')
  $('#scatter .empty-message').text(
    "Spill data isn't available right now. Try again in a few minutes."
  )
  $('#ranking-body .empty-message').text("Outfall data isn't available right now.")
  $('#map').addClass('map-error').text('No map data right now.')
}

// The online database sometimes drops a quiet connection, so try again before giving up
function loadData(attempt) {
  $.when(
    $.getJSON(API_URL + '/analysis/scatter?limit=20000&bbox=' + LONDON_BBOX),
    $.getJSON(API_URL + '/outfalls/geojson')
  )
    .done(function (scatterResponse, geojsonResponse) {
      showData(scatterResponse[0], geojsonResponse[0])
    })
    .fail(function () {
      if (attempt < LOAD_ATTEMPTS) {
        setTimeout(function () {
          loadData(attempt + 1)
        }, 1500)
      } else {
        showError()
      }
    })
}

$('#rain-slider').on('input', function () {
  state.maxRain = Number(this.value)
  render(false)
})

$('#river-select').on('change', function () {
  state.river = this.value
  state.site = 'all'
  fillOutfallSelect()
  render(true)
  fitMap()
})

$('#wet-only').on('change', function () {
  state.wetOnly = this.checked
  render(true)
})

function selectSite(key) {
  state.site = key
  $('#outfall-select').val(key)
  render(true)
}

$('#outfall-select').on('change', function () {
  selectSite(this.value)
  fitMap()
})

$('#show-all').on('click', function () {
  state.showAll = !state.showAll
  render(false)
})

$('#clear-selection').on('click', function () {
  state.river = 'all'
  state.wetOnly = false
  state.site = 'all'
  state.maxRain = DEFAULT_RAIN_MM
  state.showAll = false
  $('#river-select').val('all')
  $('#wet-only').prop('checked', false)
  $('#rain-slider').val(DEFAULT_RAIN_MM)
  fillOutfallSelect()
  $('#outfall-select').val('all')
  render(true)
  fitMap()
})

new ResizeObserver(drawScatter).observe(document.getElementById('scatter-canvas'))

$('#last-updated').text('Loading live data…')
loadData(1)
