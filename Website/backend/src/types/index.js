/**
 * JSDoc Type Definitions for Rain to Spill API
 *
 * This file contains type definitions for all API endpoints and data structures.
 * Types are organized by domain and can be imported for IDE autocompletion.
 *
 * @module types
 */


// COMMON / BASE TYPES


/**
 * Geographic coordinates in WGS84 (lat/lng)
 * @typedef {Object} Coordinates
 * @property {number} lat - Latitude in decimal degrees
 * @property {number} lng - Longitude in decimal degrees
 */

/**
 * British National Grid (OSGB36) coordinates
 * @typedef {Object} OSGBCoordinates
 * @property {number} easting - Easting in meters
 * @property {number} northing - Northing in meters
 */

/**
 * Data source indicator for cached vs live data
 * @typedef {'live' | 'cache_fallback' | 'error' | 'unavailable'} DataSource
 */

/**
 * API response wrapper
 * @typedef {Object} ApiResponse
 * @property {boolean} success - Whether the request succeeded
 * @property {string} [error] - Error message if success is false
 */

/**
 * Paginated API response
 * @typedef {Object} PaginatedResponse
 * @property {boolean} success
 * @property {number} count - Number of items returned
 * @property {Array} data - Array of items
 */


// THAMES WATER API TYPES


/**
 * Thames Water API query parameters
 * @typedef {Object} ThamesWaterQueryParams
 * @property {number} [limit=1000] - Max records per request (max 1000)
 * @property {number} [offset=0] - Pagination offset
 * @property {string} [permitNumber] - Filter by permit number
 * @property {string} [locationName] - Filter by location name
 */

/**
 * Sewage outfall location and status
 * @typedef {Object} Outfall
 * @property {string} permitNumber - Unique permit identifier (e.g., "CSAB.0530")
 * @property {string} locationName - Human-readable location name
 * @property {string} receivingWaterCourse - River/waterway receiving discharge
 * @property {number} easting - OSGB36 easting coordinate
 * @property {number} northing - OSGB36 northing coordinate
 * @property {number} lat - WGS84 latitude
 * @property {number} lng - WGS84 longitude
 * @property {string} [alertStatus] - Raw alert status from API
 * @property {boolean} isDischarging - Whether currently discharging
 * @property {boolean} alertPast48Hours - Discharge alert in last 48 hours
 * @property {string|null} mostRecentStart - ISO timestamp of most recent discharge start
 * @property {string|null} mostRecentStop - ISO timestamp of most recent discharge stop
 */

/**
 * Outfall with paired rain gauge info (from database)
 * @typedef {Object} OutfallWithGauge
 * @extends Outfall
 * @property {string|null} pairedGaugeId - EA rain gauge station ID
 * @property {number|null} gaugeDistanceKm - Distance to paired gauge in km
 */

/**
 * Discharge status API response
 * @typedef {Object} DischargeStatusResponse
 * @property {DataSource} source - Data source indicator
 * @property {string} fetchedAt - ISO timestamp when data was fetched
 * @property {number} count - Number of outfalls returned
 * @property {number} [totalFromApi] - Total records from API before filtering
 * @property {ThamesWaterQueryParams} [params] - Query parameters used
 * @property {string} [error] - Error message if using cache fallback
 * @property {Outfall[]} items - Array of outfall statuses
 */

/**
 * Raw discharge alert from Thames Water API
 * @typedef {Object} DischargeAlert
 * @property {string} permitNumber - Outfall permit number
 * @property {string} locationName - Location name
 * @property {string} receivingWaterCourse - Receiving waterway
 * @property {string} alertType - Alert type: "Start", "Stop", "Offline Start", "Offline Stop"
 * @property {string} eventTime - ISO timestamp of alert (from datetime field)
 * @property {number} easting - OSGB36 easting
 * @property {number} northing - OSGB36 northing
 */

/**
 * Discharge alerts API response
 * @typedef {Object} DischargeAlertsResponse
 * @property {DataSource} source - Data source indicator
 * @property {string} fetchedAt - ISO timestamp when data was fetched
 * @property {number} count - Number of alerts returned
 * @property {number} [totalFromApi] - Total records from API before filtering
 * @property {ThamesWaterQueryParams} [params] - Query parameters used
 * @property {string} [error] - Error message if using cache fallback
 * @property {DischargeAlert[]} items - Array of alerts
 */

/**
 * Paired spill event (Start + Stop matched)
 * @typedef {Object} SpillEvent
 * @property {string} permitNumber - Outfall permit number
 * @property {string} [locationName] - Location name
 * @property {'discharge' | 'offline'} type - Event type
 * @property {string} startTime - ISO timestamp of discharge start
 * @property {string|null} stopTime - ISO timestamp of discharge stop (null if ongoing)
 * @property {number} durationMinutes - Duration in minutes
 * @property {boolean} ongoing - Whether the event is still ongoing
 */

/**
 * Discharge duration summary statistics
 * @typedef {Object} DischargeSummary
 * @property {number} totalMinutes - Total discharge duration in minutes
 * @property {number} totalHours - Total discharge duration in hours (rounded to 2dp)
 * @property {number} eventCount - Number of discharge events
 */

/**
 * Spill history response for a single outfall
 * @typedef {Object} SpillHistoryResponse
 * @property {DataSource} source - Data source indicator
 * @property {string} fetchedAt - ISO timestamp when data was fetched
 * @property {string} permitNumber - Outfall permit number
 * @property {string} [error] - Error message if source is 'error'
 * @property {Object} [summary] - Summary statistics by time period
 * @property {DischargeSummary} [summary.last48Hours] - Stats for last 48 hours
 * @property {DischargeSummary} [summary.last7Days] - Stats for last 7 days
 * @property {DischargeSummary} [summary.last30Days] - Stats for last 30 days
 * @property {DischargeSummary} [summary.last6Months] - Stats for last 6 months
 * @property {DischargeSummary} [summary.last12Months] - Stats for last 12 months
 * @property {DischargeSummary} [summary.yearToDate] - Stats for year to date
 * @property {DischargeSummary} [summary.allTime] - All-time stats
 * @property {SpillEvent[]} events - Recent spill events (max 100)
 */

/**
 * Outfall summary with 30-day discharge stats
 * @typedef {Object} OutfallSummary
 * @property {string} permitNumber - Outfall permit number
 * @property {string} locationName - Location name
 * @property {string} receivingWaterCourse - Receiving waterway
 * @property {number} lat - WGS84 latitude
 * @property {number} lng - WGS84 longitude
 * @property {boolean} isCurrentlyDischarging - Whether currently discharging
 * @property {boolean} alertPast48Hours - Alert in last 48 hours
 * @property {DischargeSummary} last30Days - 30-day discharge summary
 */

/**
 * London spill summary response
 * @typedef {Object} LondonSpillSummaryResponse
 * @property {DataSource} source - Data source indicator
 * @property {string} fetchedAt - ISO timestamp when data was fetched
 * @property {string} period - Time period for stats (e.g., "last30Days")
 * @property {number} totalOutfalls - Total number of London outfalls
 * @property {number} currentlyDischarging - Number currently discharging
 * @property {number} recentlyDischarged - Number with 48h alert
 * @property {number} totalDischargeMinutes - Combined discharge minutes
 * @property {number} totalDischargeHours - Combined discharge hours
 * @property {string} [error] - Error message if source is 'error'
 * @property {OutfallSummary[]} outfalls - Sorted array of outfall summaries
 */


// ENVIRONMENT AGENCY API TYPES


/**
 * Tidal reading from EA flood monitoring API
 * @typedef {Object} TidalReading
 * @property {string} timestamp - ISO timestamp of reading
 * @property {number} levelMAOD - Water level in meters above ordnance datum
 */

/**
 * Tidal phase indicator
 * @typedef {'FLOOD' | 'EBB'} TidalPhase
 */

/**
 * Dispersion state for sewage
 * @typedef {'TIDALLY_TRAPPED' | 'FLUSHED'} DispersionState
 */

/**
 * Tidal status response
 * @typedef {Object} TidalStatusResponse
 * @property {DataSource} source - Data source indicator
 * @property {string} stationId - EA station ID (e.g., "0001" for Silvertown)
 * @property {string} timestamp - ISO timestamp of latest reading
 * @property {number} currentLevelMAOD - Current water level
 * @property {number} previousLevelMAOD - Previous reading (15 min ago)
 * @property {number|null} upstreamLeaBridgeStageM - Upstream stage at Lea Bridge
 * @property {number} delta15Min - Change in level over 15 minutes
 * @property {number|null} hydraulicGradient - Difference between upstream and current
 * @property {TidalPhase} tidalPhase - Current tidal phase
 * @property {DispersionState} dispersionState - Sewage dispersion state
 * @property {string} [error] - Error message if using cache fallback
 * @property {TidalReading[]} series - Recent readings (up to 12)
 */

/**
 * Simulated tidal trapping response (with offset)
 * @typedef {Object} SimulatedTideResponse
 * @property {string} stationId - EA station ID
 * @property {string} selectedTimestamp - Timestamp of selected reading
 * @property {number} levelMAOD - Water level at selected time
 * @property {number} delta15Min - Change from prior reading
 * @property {TidalPhase} tidalPhase - Tidal phase at selected time
 * @property {DispersionState} dispersionState - Dispersion state at selected time
 * @property {number} simulatedResidenceHours - Estimated pollutant residence time
 * @property {TidalReading[]} series - Available readings
 */

/**
 * Rainfall reading
 * @typedef {Object} RainfallReading
 * @property {string} gaugeId - EA rain gauge station ID
 * @property {string} timestamp - ISO timestamp of reading
 * @property {number} mm - Rainfall in millimeters (per 15 min)
 */

/**
 * Rainfall status response
 * @typedef {Object} RainfallStatusResponse
 * @property {DataSource} source - Data source indicator
 * @property {string} gaugeId - EA rain gauge station ID
 * @property {number} total24hMm - Total rainfall in last 24 hours
 * @property {number} currentRateMmHr - Current rainfall rate (mm/hour)
 * @property {number} count - Number of readings returned
 * @property {string} [error] - Error message if using cache fallback
 * @property {RainfallReading[]} readings - Array of readings
 */


// EXTERNAL API TYPES (Open Meteo, RainViewer, EA Flood Alerts)


/**
 * Open Meteo soil moisture and precipitation data
 * @typedef {Object} SoilAndWeatherData
 * @property {DataSource} source - Data source indicator
 * @property {number|null} soilMoisture0to1cm - Soil moisture in top 1cm (m³/m³)
 * @property {number|null} precipitationMm - Current precipitation in mm
 */

/**
 * RainViewer weather radar data
 * @typedef {Object} WeatherRadarData
 * @property {DataSource} source - Data source indicator
 * @property {string|null} host - Tile server host URL
 * @property {string|null} latestFramePath - Path to latest radar frame
 * @property {number|null} timestamp - Unix timestamp of latest frame
 */

/**
 * EA flood alert item
 * @typedef {Object} FloodAlert
 * @property {string} areaName - EA area name
 * @property {string} description - Alert description
 * @property {string} severity - Severity text
 * @property {number} severityLevel - Severity level (1-4)
 * @property {string} timeRaised - ISO timestamp when alert was raised
 */

/**
 * EA flood alerts response
 * @typedef {Object} FloodAlertsData
 * @property {DataSource} source - Data source indicator
 * @property {number} count - Number of active alerts
 * @property {FloodAlert[]} items - Array of flood alerts
 */


// COMBINED STATUS API TYPES


/**
 * Combined status data from all sources
 * @typedef {Object} OverallStatusData
 * @property {DischargeStatusResponse} discharges - Sewage discharge status
 * @property {RainfallStatusResponse} rainfall - Rainfall data
 * @property {TidalStatusResponse} tide - Tidal data
 * @property {SoilAndWeatherData} soilAndWeather - Soil moisture and weather
 * @property {WeatherRadarData} weatherRadar - Rain radar data
 * @property {FloodAlertsData} floodAlerts - EA flood alerts
 */

/**
 * Overall status API response
 * @typedef {Object} OverallStatusResponse
 * @property {boolean} success - Whether request succeeded
 * @property {string} timestamp - ISO timestamp when response was generated
 * @property {OverallStatusData} data - Combined status data
 */


// DATABASE / SPILL EVENT TYPES


/**
 * Spill event record from database
 * @typedef {Object} SpillEventRecord
 * @property {number} id - Database record ID
 * @property {string} permitNumber - Outfall permit number
 * @property {string|null} locationName - Location name
 * @property {string} startTime - ISO timestamp of start
 * @property {string|null} stopTime - ISO timestamp of stop
 * @property {number} durationHours - Duration in hours (calculated)
 * @property {number|null} rain24hMm - 24-hour rainfall at start
 * @property {TidalPhase|null} tidalPhaseAtStart - Tidal phase at start
 * @property {boolean|null} isTidallyTrapped - Whether tidally trapped
 */

/**
 * Outfall threshold statistics
 * @typedef {Object} OutfallThreshold
 * @property {string} permitNumber - Outfall permit number
 * @property {string} locationName - Location name
 * @property {string} receivingWaterCourse - Receiving waterway
 * @property {number} lat - WGS84 latitude
 * @property {number} lng - WGS84 longitude
 * @property {number} minRain24hMm - Minimum 24h rainfall that triggered spill
 * @property {number} avgRain24hMm - Average 24h rainfall during spills
 * @property {number} spillCount - Total number of spill events
 */


// API ENDPOINT RESPONSE TYPES


/**
 * GET /api/outfalls response
 * @typedef {Object} ListOutfallsResponse
 * @property {boolean} success
 * @property {number} count
 * @property {OutfallWithGauge[]} data
 */

/**
 * GET /api/outfalls/:id response
 * @typedef {Object} GetOutfallResponse
 * @property {boolean} success
 * @property {Outfall} [data] - Outfall data if found
 * @property {string} [error] - "Outfall not found" if not found
 */

/**
 * GET /api/outfalls/:id/history response
 * @typedef {Object} GetOutfallHistoryResponse
 * @property {boolean} success
 * @property {SpillHistoryResponse} [data] - History data
 * @property {string} [error] - Error message if failed
 */

/**
 * GET /api/outfalls/summary response
 * @typedef {Object} GetLondonSummaryResponse
 * @property {boolean} success
 * @property {LondonSpillSummaryResponse} [data] - Summary data
 * @property {string} [error] - Error message if failed
 */

/**
 * GET /api/events response
 * @typedef {Object} ListEventsResponse
 * @property {boolean} success
 * @property {number} count
 * @property {SpillEventRecord[]} data
 */

/**
 * GET /api/tide response
 * @typedef {Object} GetTideResponse
 * @property {boolean} success
 * @property {TidalStatusResponse|SimulatedTideResponse} data
 */

/**
 * GET /api/thresholds response
 * @typedef {Object} ListThresholdsResponse
 * @property {boolean} success
 * @property {number} count
 * @property {OutfallThreshold[]} data
 */

/**
 * GET /api/status response
 * @typedef {OverallStatusResponse} GetStatusResponse
 */


// EXPORTS (for IDE autocompletion when importing)


// This file only contains JSDoc type definitions.
// Export an empty object to allow importing the module for type hints.
export default {};
