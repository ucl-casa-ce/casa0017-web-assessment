/* global $ */

const API_URL = 'http://localhost:3000/api'

const GAUGE_MAX_MM = 30

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

let lowestRain = null
let gaugeSeen = false

document.documentElement.classList.add('js')

const revealObserver = new IntersectionObserver(
  function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible')
        revealObserver.unobserve(entry.target)
        if (entry.target.id === 'gauge-figure') {
          gaugeSeen = true
          showLowestRain()
        }
      }
    })
  },
  { threshold: 0.2 }
)

document.querySelectorAll('[data-reveal]').forEach(function (el) {
  revealObserver.observe(el)
})

const TIDE_CAPTIONS = {
  falling: '<strong>Falling tide.</strong> Carried out to the Thames.',
  rising: '<strong>Rising tide.</strong> Pushed back toward Stratford.',
}

function showLowestRain() {
  if (lowestRain === null || !gaugeSeen) {
    return
  }

  const percent = Math.min(lowestRain / GAUGE_MAX_MM, 1) * 100
  $('#gauge-fill').css('height', percent + '%')
  $('#lowest-rain').removeClass('is-empty')

  if (reduceMotion) {
    $('#lowest-rain').text(lowestRain + ' mm')
    return
  }

  $({ value: 0 }).animate(
    { value: lowestRain },
    {
      duration: 1600,
      step: function (now) {
        $('#lowest-rain').text(now.toFixed(1) + ' mm')
      },
      complete: function () {
        $('#lowest-rain').text(lowestRain + ' mm')
      },
    }
  )
}

function showTide(tide) {
  $('#river').toggleClass('rising', tide === 'rising')

  $('.tide-button').attr('aria-pressed', 'false')
  $('.tide-button[data-tide="' + tide + '"]').attr('aria-pressed', 'true')

  $('#tide-caption').html(TIDE_CAPTIONS[tide])
}

$('.tide-button').on('click', function () {
  showTide($(this).data('tide'))
})

$('#last-updated').text('Loading live data…')

$.getJSON(API_URL + '/status')
  .done(function (response) {
    const data = response.data

    if (data.rainfall && data.rainfall.count > 0) {
      $('#rain-now').text(data.rainfall.total24hMm + ' mm').removeClass('is-empty')
    }

    const outfalls = data.discharges.items
    if (outfalls.length > 0) {
      let spilling = 0
      $.each(outfalls, function (i, outfall) {
        // isDischarging is true/false when live, 1/0 from the database
        if (Number(outfall.isDischarging) === 1) {
          spilling = spilling + 1
        }
      })
      $('#spilling-now')
        .html(spilling + '<span class="reading-of"> of ' + outfalls.length + '</span>')
        .removeClass('is-empty')
    }

    if (data.tide && data.tide.tidalPhase) {
      const tide = data.tide.tidalPhase === 'FLOOD' ? 'rising' : 'falling'
      $('#tide-now')
        .text(tide === 'rising' ? 'Rising' : 'Falling')
        .removeClass('is-empty')

      $('.tide-button[data-tide="' + tide + '"]').addClass('is-now')
      showTide(tide)
    }

    const time = new Date(response.timestamp).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    })
    $('#last-updated').text('Live, updated ' + time)
  })
  .fail(function () {
    $('#last-updated').text('Live data unavailable')
    $('#live-message').text("Live readings aren't available right now. Try again in a few minutes.")
  })

$.getJSON(API_URL + '/thresholds').done(function (response) {
  const outfalls = response.data

  if (outfalls.length === 0) {
    $('#lowest-rain-text').text('No spills recorded yet. This fills in after the first one.')
    return
  }

  const first = outfalls[0]
  lowestRain = Number(first.minRain24hMm)
  showLowestRain()

  let totalSpills = 0
  $.each(outfalls, function (i, outfall) {
    totalSpills = totalSpills + Number(outfall.spillCount)
  })

  $('#lowest-rain-text').text(
    'Rain before a spill at ' +
      first.locationName +
      '. The lowest of ' +
      totalSpills +
      " spills we've recorded."
  )
})
