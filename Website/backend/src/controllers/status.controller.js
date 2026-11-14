import axios from 'axios';
import { fetchDischargeStatus } from '../services/thamesWater.service.js';
import { fetchRainfallStatus, fetchTidalStatus } from '../services/eaFlood.service.js';

export async function getOverallStatus(req, res, next) {
  try {
    const [discharges, rainfall, tide, weatherRadar, soilAndWeather, floodAlerts] =
      await Promise.all([
        fetchDischargeStatus(),
        fetchRainfallStatus(),
        fetchTidalStatus(),
        fetchRainViewerRadar(),
        fetchOpenMeteoSoil(),
        fetchEaFloodAlerts()
      ]);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        discharges,
        rainfall,
        tide,
        soilAndWeather,
        weatherRadar,
        floodAlerts
      }
    });
  } catch (error) {
    next(error);
  }
}

async function fetchOpenMeteoSoil() {
  try {
    const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: 51.53,
        longitude: -0.01,
        minutely_15: 'precipitation,soil_moisture_0_to_1cm',
        forecast_minutely_15: 4
      },
      timeout: 5000
    });
    return {
      source: 'live',
      soilMoisture0to1cm: data?.minutely_15?.soil_moisture_0_to_1cm?.[0] ?? null,
      precipitationMm: data?.minutely_15?.precipitation?.[0] ?? 0
    };
  } catch {
    return { source: 'unavailable', soilMoisture0to1cm: null, precipitationMm: null };
  }
}

async function fetchRainViewerRadar() {
  try {
    const { data } = await axios.get(
      'https://api.rainviewer.com/public/weather-maps.json',
      { timeout: 5000 }
    );
    const pastFrames = data?.radar?.past || [];
    const latestFrame = pastFrames[pastFrames.length - 1] || null;
    return {
      source: 'live',
      host: data?.host || 'https://tilecache.rainviewer.com',
      latestFramePath: latestFrame?.path || null,
      timestamp: latestFrame?.time || null
    };
  } catch {
    return { source: 'unavailable', latestFramePath: null };
  }
}

async function fetchEaFloodAlerts() {
  try {
    const { data } = await axios.get(
      'https://environment.data.gov.uk/flood-monitoring/id/floods',
      { params: { county: 'Greater London' }, timeout: 5000 }
    );
    const items = (data?.items || []).map((item) => ({
      areaName: item.eaAreaName,
      description: item.description,
      severity: item.severity,
      severityLevel: item.severityLevel,
      timeRaised: item.timeRaised
    }));
    return { source: 'live', count: items.length, items };
  } catch {
    return { source: 'unavailable', count: 0, items: [] };
  }
}