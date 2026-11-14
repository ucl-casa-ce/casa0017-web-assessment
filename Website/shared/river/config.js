// =====================================================================
//  CONFIG — every tunable parameter for the Thames sewage-impact map.
//  Values marked [ASSUMPTION] are uncalibrated defaults: change them
//  once you have field data (e.g. EA bathing-water samples, dye tests).
// =====================================================================

export const CONFIG = {
  // -------------------------------------------------------------- brand
  // The map's name and slogan, used by the share image, club embed and WhatsApp messages.
  // The same two texts are also written directly in Website/frontend/live.html (page title,
  // description, panel heading, start card, About box): change them there too.
  brand: {
    name: 'Live ThameSafe Spill Map',
    slogan: 'Proactive, speedy and informative sewage risk assessments for Thames River users.',
  },
  // ---------------------------------------------------------------- map
  map: {
    // Free vector basemap used in the deck.gl MapLibreOverlay docs example.
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [-0.75, 51.52],   // [lon, lat] – whole non-tidal + tidal Thames
    zoom: 8.3,
    londonView: { center: [-0.17, 51.48], zoom: 11 }, // "Zoom to London" button
    // deck.gl river layer is inserted *under* the first symbol (label)
    // layer so place names stay readable. Set an explicit id to override.
    labelLayerId: null,
  },

  // ---------------------------------------------------------- endpoints
  // The browser asks the Rain To Spill backend (Website/backend) for everything:
  //   GET  {api}/api/river/inputs     model inputs (overflows, flows, rain, tides, propensity)
  //   GET/POST {api}/api/river/sightings, POST {api}/api/river/subscribe
  // {api} = VITE_API_URL (frontend .env), set at start-up in src/river/app.js.
  // The upstream URLs below are used by the backend only (src/river/sources.js).
  api: {
    base: 'http://localhost:3000',
    inputs: '/api/river/inputs',
    inputsTimeoutMs: 60000,
  },
  endpoints: {
    // Thames Water EDM "current status" (v2 open data). Base URL comes from the
    // backend's THAMES_WATER_BASE_URL (config.apis.thamesWaterBaseUrl).
    thamesWaterStatusPath: '/discharge/status',
    // Open-Meteo forecast (no key). Attribution required.
    openMeteo: 'https://api.open-meteo.com/v1/forecast',
    // Tide predictions come from the backend's existing EasyTide service
    // (services/tideForecast.service.js), station below (tide.easyTideStationId).
  },

  refresh: {
    dischargeMinutes: 15, // TW EDM updates ~every 15 min -> full data + model refresh
    staleOnFocusMinutes: 5, // refresh when the tab regains focus and data is older than this
  },

  // The "now" marker, slider and chart follow the real clock while in live mode.
  live: {
    tickSeconds: 30,
  },

  // ----------------------------------------------------- Thames Water
  thamesWater: {
    // [ASSUMPTION] TW timestamps have no offset (e.g. "2023-01-13T18:15:00").
    // false = treat as UK local clock time (Europe/London), true = UTC.
    timesAreUtc: false,
    // Discharges with no stop time are assumed to continue for this many
    // hours beyond "now" (observed component). [ASSUMPTION]
    assumedOngoingHours: 6,
    // How far back finished discharges are still modelled as present in
    // the river. Should be >= ~2x t90Hours below.
    recentWindowHours: 72,
    // Offline monitors: 0 = ignore, >0 = treat as uncertain spill weight.
    offlineWeight: 0,
  },

  // ---------------------------------------------------------- the river
  river: {
    // OS Open Rivers centreline (341 km, Thames Head -> outer estuary), built by
    // scripts/build-thames-centreline.mjs from WatercourseLink.shp. Must be an
    // ordered LineString in WGS84, source -> sea. null = fall back to the
    // approximate waypoints in src/data/thamesCentreline.js (257 km).
    geojsonUrl: 'thames-centreline.geojson',
    sampleSpacingKm: 0.5, // resolution of the impact field along the river (km)
    // Overflows further than this from the Thames centreline are ignored.
    // Most TW overflows discharge to tributaries; they are "routed" to the
    // nearest Thames point with an extra delay (see hydraulics). [ASSUMPTION]
    snapMaxKm: 25,
    // Only keep overflows whose receiving water mentions one of these
    // (case-insensitive). [] = keep everything within snapMaxKm.
    receivingWaterFilter: [],
    // Name of the waypoint marking the tidal limit (Teddington weir).
    tidalLimitWaypoint: 'Teddington Lock',
  },

  // -------------------------------------------------------- hydraulics
  // Mean velocity from EA gauged flow Q (m3/s): v = a * Q^b, clamped.
  // This is a hydraulic-geometry power law, NOT measured velocity. [ASSUMPTION]
  hydraulics: {
    a: 0.1,
    b: 0.34,          // Q=60 m3/s -> ~0.40 m/s ; Q=300 -> ~0.70 m/s
    vMin: 0.08,       // m/s
    vMax: 1.2,        // m/s
    defaultFlowM3s: 40, // used where no EA flow gauge is upstream
    tributaryVelocity: 0.35, // m/s along a tributary before reaching Thames
    tributarySinuosity: 1.4, // straight-line distance x this = channel length
  },

  // -------------------------------------------------------------- tide
  // Below Teddington, parcels oscillate with the tide plus a slow net
  // seaward drift. Phase comes from Admiralty predicted high waters, else
  // EA observed tidal levels, else fallbackHighWaterUtc. [ASSUMPTION]
  tide: {
    periodHours: 12.42,          // M2 semidiurnal period
    excursionKm: 14,             // peak-to-trough tidal excursion of a parcel
    netSeawardKmPerDay: 3,       // residual drift (flow-dependent in reality)
    easyTideStationId: '0113',   // London Bridge (Tower Pier) — THAMES_STATIONS.LONDON_BRIDGE in tideForecast.service.js
    eaTidalSearch: { lat: 51.5075, long: -0.0877, distKm: 6 },
    fallbackHighWaterUtc: null,  // e.g. '2026-11-07T14:20:00Z'
  },

  // ------------------------------------------------ decay & dispersion
  decay: {
    // Time for 90% bacterial die-off (central value). Lab river-water studies
    // give E. coli 99% die-off of ~2–3 days at 15–25 °C, i.e. T90 ≈ 24–36 h;
    // colder winter water lasts longer. [ASSUMPTION]
    t90Hours: 30,
    dispersionKm2PerHour: 0.6,  // longitudinal dispersion (sigma^2 growth)
    minSigmaKm: 0.4,
  },

  // ------------------------------------------------- simulation window
  sim: {
    pastHours: 24,       // slider start (relative to now)
    horizonHours: 168,   // 7 days: matches the ADMIRALTY tidal predictions
    stepMinutes: 15,     // parcel release + integration step
    frameMinutes: 60,    // output resolution (slider / chart / alerts)
  },

  // ---------------------------------------- rain-driven spill forecast
  forecast: {
    rainVariable: 'precipitation',
    accumHours: 6,       // rolling rainfall window that drives spills
    r50mm: 8,            // 6-h rain giving 50% spill chance at an average site
    slopeMm: 3,          // logistic steepness (smaller = sharper threshold)
    siteBase: 0.6,       // max probability when no propensity data
    recentBoost: 1.3,    // multiply p if site spilled in last 48 h (wet catchment)
    minRainMm: 2,        // below this accumulated rain, p = 0 (no dry spills)
    minProbability: 0.05, // ignore forecast hours below this chance
    // Overflows are grouped into weather cells by rounding their position to this many decimal
    // places: 1 = 0.1° (about 7 x 11 km, close to the forecast model's own grid), 2 = 0.01°.
    // Each cell is one Open-Meteo location, and the free service allows under 10,000 a day,
    // so 2 can use up the day's allowance within a few hours.
    gridDp: 1,
    forecastDays: 8,     // Open-Meteo forecast_days (max 16); 8 covers +168 h
    // Per-overflow rainfall thresholds from the team's analysis
    // (backend getRainfallThresholds(): lowest and average 24-h rain before each
    // overflow's past spills). Where an overflow has one, it replaces the shared
    // curve above (accumHours / r50mm / slopeMm): the chance of spilling starts
    // at the overflow's LOWEST recorded trigger rain and reaches half the site's
    // maximum at its AVERAGE trigger rain. Other overflows keep the shared curve.
    thresholds: {
      enabled: true,     // false = shared curve for every overflow
      windowHours: 24,   // the team's thresholds are 24-h rain totals — keep in step with rain_24h_mm
      minSpills: 5,      // fewer past spills with rain data than this = not enough evidence, use the shared curve
      onsetShare: 0.1,   // share of the site's maximum chance at its lowest trigger rain [ASSUMPTION]
      minSlopeMm: 1,     // limits on how sharply the chance rises (mm of rain)
      maxSlopeMm: 10,
    },
  },

  // --------------------------------------------- uncertainty (ensemble)
  // The model is run once with central values ("central estimate") and
  // `members` more times with each uncertain input drawn at random. Spread
  // across those runs gives the 10–90% range, standard deviation and the
  // chance of reaching each level. All sigmas are log-normal (×/÷ e^σ) unless
  // noted. [ASSUMPTION] — widths are judgement, to be narrowed by calibration.
  uncertainty: {
    members: 16,
    velocitySigma: 0.25,     // river speed multiplier
    t90Sigma: 0.4,           // die-off time (≈ 20–45 h for 1 σ around 30 h)
    dispersionSigma: 0.5,
    excursionSd: 0.15,       // tidal excursion, normal, as a fraction
    netDriftSigma: 0.5,
    ongoingSigma: 0.5,       // how long a current spill keeps going
    volumeSigma: 0.7,        // per-overflow spill strength (EDM gives no volume)
    rainSigmaDay0: 0.25,     // rain forecast error on day 0 …
    rainSigmaPerDay: 0.1,    // … growing by this per day of lead time
    // Tide phase error (hours) by data source
    phaseSdHours: { admiralty: 0.25, ea: 0.75, fallback: 3 },
    // Age classes for the dispersion kernel (hours)
    ageClassesH: [0, 2, 6, 12, 24, 48, 96],
    decayCutoff: 0.01,       // stop tracking a parcel below 1% of its load
  },

  // ------------------------------------------------------------ impact
  // Index unit: spill-hours per km (SH/km) after die-off — a RELATIVE score,
  // not a bacteria count. 1 SH/km = one hour of overflow discharge spread over
  // one km of river with no die-off yet. See methodology.html.
  impact: {
    unit: 'SH/km',
    thresholds: { low: 0.02, moderate: 0.15, high: 0.6 },
    alertThreshold: 0.15,   // in-app banner on "your stretch" at or above this
    alertProbability: 0.3,  // … when the chance of reaching it is at least this
  },

  // ------------------------------------------------- traffic-light risk
  // The plain-language status shown to users. Same rules on the map, the
  // outlook, the share card and the WhatsApp alerts (src/model/risk.js).
  //   HIGH risk      central ≥ high threshold   OR chance of HIGH      ≥ probability
  //   MODERATE risk  central ≥ moderate         OR chance of MODERATE+ ≥ probability
  //   LOW risk       otherwise
  // [ASSUMPTION] 30% is precautionary: a 1-in-3 chance is enough to warn.
  risk: {
    probability: 0.3,
    // Certainty wording (High / Medium / Low) from the share of model runs agreeing with the light
    certaintyLabel: 'Certainty', // shown as "Certainty: High" — e.g. change to 'Likelihood' or 'Confidence'
    confidence: { high: 0.7, medium: 0.4 },
    // What every light refers to, shown under the status (keep it plain; the methodology has the detail)
    meaning: 'How likely it is that sewage from storm overflows is in the water on this stretch. Sewage carries germs, so it is a health risk if you swallow river water or it gets into cuts.',
    // advice = what to DO, in a few words. The light and its label already say how likely sewage
    // is, so the advice does not repeat it.
    levels: {
      low: {
        label: 'Low sewage risk', short: 'Low', colour: '#1e8a4c', text: '#ffffff', icon: '✓', emoji: '🟢',
        advice: 'Take your usual care.',
      },
      moderate: {
        label: 'Moderate sewage risk', short: 'Moderate', colour: '#f2a900', text: '#1a1a1a', icon: '!', emoji: '🟠',
        advice: 'Avoid swallowing water and cover cuts.',
      },
      high: {
        label: 'High sewage risk', short: 'High', colour: '#c62828', text: '#ffffff', icon: '✕', emoji: '🔴',
        advice: 'Consider staying out of the water.',
      },
    },
  },

  // ---------------------------------------------- spots and favourites
  spots: {
    // How far up and downstream "your stretch" reaches when a spot is chosen. Must be one of the
    // choices in the panel's drop-down (1, 3, 5 or 10). Once the user picks a length themselves,
    // their choice is kept for every later spot.
    defaultRadiusKm: 3,  // spot from search, "locate me" or a club
    clickRadiusKm: 3,    // spot from clicking / tapping the river
    // The map flies to a newly chosen spot and zooms in to at least this level (never zooms out).
    flyZoom: 12.5,       // search, "locate me", saved spots
    clickZoom: 12.5,     // clicking / tapping the river
    maxFavourites: 12,
    storageKey: 'thames-spill-map:favourites:v1', // browser localStorage, never sent anywhere
    postcodeLookup: 'https://api.postcodes.io/postcodes/', // free, no key
    clubsUrl: 'clubs.json', // built from OpenStreetMap by `npm run river:clubs` in Website/backend
    // Live place + club search as you type (no keys). Set either to null to switch it off.
    //  - OS Open Names via postcodes.io: neighbourhoods, villages, towns ("Canary Wharf", "Mortlake")
    //  - Photon (komoot, OpenStreetMap data): named places and points of interest incl. clubs
    //    ("Thames Rowing Club", "Royal Canoe Club"). Fair-use public server: run your own for heavy use.
    placesUrl: 'https://api.postcodes.io/places',
    photonUrl: 'https://photon.komoot.io/api/',
    searchBbox: [-2.2, 51.2, 1.0, 51.95], // minLon,minLat,maxLon,maxLat — Thames catchment to the estuary
    searchFocus: [-0.25, 51.48],          // Photon prefers results near here (London)
    remoteMinChars: 3,
    remoteDebounceMs: 350,
    searchSnapKm: 8,    // a searched place up to this far from the river opens the nearest stretch
    clubMaxOffKm: 1.5,  // an OSM point counts as a river club only within this distance of the river
  },

  // ------------------------------------------------ WhatsApp alerts (UI)
  // Server-side behaviour (cooldown, quiet hours, templates) is in server/settings.mjs.
  alerts: {
    apiBase: '/api/river',  // backend routes (Website/backend/src/river); prefixed with CONFIG.api.base
    maxOffRiverKm: 3,       // keep in sync with server/settings.mjs
  },

  // ------------------------------------------- citizen sightings
  sightings: {
    apiBase: '/api/river',
    showDays: 7,            // sightings shown on the map
    refreshMinutes: 2,
    types: ['Sewage solids / sanitary items', 'Grey or discoloured water', 'Sewage smell',
      'Foam or scum', 'Dead fish', 'Overflow pipe flowing', 'Other'],
    severities: ['Minor', 'Noticeable', 'Severe'],
    maxNote: 280,
    // reCAPTCHA v3 (invisible). Site key from VITE_RECAPTCHA_SITE_KEY in .env.local;
    // the secret stays on the server (RECAPTCHA_SECRET). Empty = disabled (dev only).
    recaptchaSiteKey: '', // set from VITE_RECAPTCHA_SITE_KEY in src/river/app.js (browser only)
    recaptchaAction: 'sighting',
    // Official channel: the EA 24-hour incident hotline / online form.
    officialReportUrl: 'https://www.gov.uk/report-water-pollution',
    officialPhone: '0800 80 70 60',
  },

  // ------------------------------------- next 24 hours: rain + tide context
  // Shown under the traffic light. Plain-language context only: the status
  // itself still comes from the model. [ASSUMPTIONS]
  context: {
    hours: 24,             // length of the strip
    tickHours: 3,          // time labels every N hours
    // Rain strength per hour (mm/h), American Meteorological Society glossary:
    // light ≤ 2.5, moderate 2.6–7.6, heavy > 7.6. Below 'trace' counts as dry.
    rain: { trace: 0.1, moderate: 2.6, heavy: 7.6 },
    rainRadiusKm: 15,      // average the forecast over weather cells within this distance of your spot…
    rainFallbackKm: 30,    // …or use the nearest cell within this distance
    wetDayMm: 6,           // 24-h total above which the summary warns that rain can set off overflows
    // Tide times are predicted for London Bridge (Tower Pier); other places are
    // shifted by the Port of London Authority's average differences (hours:minutes
    // → minutes). Between listed places the shift is interpolated along the river;
    // beyond them it is held at the nearest listed value (approximate).
    tideOffsets: [
      { name: 'Teddington Lock', c: [-0.3220, 51.4310], hw: 61, lw: 170 },   // LW not given for Teddington: Richmond's used
      { name: 'Richmond Lock', c: [-0.3170, 51.4630], hw: 61, lw: 170 },
      { name: 'Kew Bridge', c: [-0.2870, 51.4870], hw: 52, lw: 166 },
      { name: 'Barnes Railway Bridge', c: [-0.2540, 51.4720], hw: 44, lw: 139 },
      { name: 'Hammersmith Bridge', c: [-0.2300, 51.4880], hw: 38, lw: 118 },
      { name: 'Putney Bridge', c: [-0.2135, 51.4668], hw: 31, lw: 98 },
      { name: 'Chelsea Bridge', c: [-0.1497, 51.4846], hw: 14, lw: 45 },
      { name: 'London Bridge', c: [-0.0870, 51.5080], hw: 0, lw: 0 },
      { name: 'Greenland Dock', c: [-0.0330, 51.4972], hw: -9, lw: -14 },
    ],
  },

  // ---------------------------------------------------- embed on club sites
  embed: {
    heights: { card: 720, map: 920 }, // suggested iframe heights (px) for the two embed styles
  },

  activities: ['Swimming', 'Rowing', 'Paddleboard', 'Kayak/Canoe', 'Sailing', 'Angling', 'Other'],
};
