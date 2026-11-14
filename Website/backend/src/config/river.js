/**
 * Settings for the river-user features (sightings, WhatsApp alerts, reCAPTCHA).
 * Secrets come from environment variables (backend/.env, see .env.example);
 * everything else is a tunable default. Model parameters live in
 * Website/shared/river/config.js (shared with the browser).
 */
import './env.js'; // loads .env

const env = process.env;

const RIVER = Object.freeze({
  // Public URL of the map (the frontend), used in WhatsApp messages
  publicMapUrl: env.PUBLIC_MAP_URL || 'http://localhost:5173',
  // DRY_RUN=1 logs WhatsApp messages instead of sending them (default when no token is set)
  dryRun: env.DRY_RUN === '1' || !env.WHATSAPP_TOKEN,

  whatsapp: {
    graphVersion: env.GRAPH_VERSION || 'v21.0', // [ASSUMPTION] bump to Meta's current version
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    appSecret: env.WHATSAPP_APP_SECRET || '',     // verifies X-Hub-Signature-256
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '', // your own random string for webhook setup
    language: 'en_GB',
    templates: {
      optin: 'thames_alert_optin',     // {{1}} radius km, {{2}} place
      status: 'thames_status_update',  // {{1}} stretch {{2}} headline {{3}} reason {{4}} 7 days {{5}} advice {{6}} link
    },
  },

  alerts: {
    enabled: env.RIVER_ALERTS_ENABLED !== 'false',
    schedule: env.RIVER_ALERTS_SCHEDULE || '*/15 * * * *', // matches Thames Water EDM update rate
    downgradeHoldMinutes: 60, // an improvement must last this long before we say so
    minGapMinutes: 60,        // at most one update per hour, except a rise to HIGH
    warnAheadHours: 12,       // early-warning window for forecast rises
    sightingRadiusKm: 5,
    sightingHours: 24,
    quietHours: { start: 22, end: 7 }, // UK local; only rises to HIGH are sent overnight
    radiusOptionsKm: [1, 3, 5, 10],
    maxOffRiverKm: 3,
    pendingExpiryHours: 48,   // delete unconfirmed sign-ups
  },

  sightings: {
    maxOffRiverKm: 5,
    maxAgeHours: 72,
    retainDays: 90,
    perIpPerHour: 10,
    adminToken: env.ADMIN_TOKEN || '', // DELETE /api/river/sightings/:id with header x-admin-token
  },

  recaptcha: {
    secret: env.RECAPTCHA_SECRET || '',
    verifyUrl: env.RECAPTCHA_VERIFY_URL || 'https://www.google.com/recaptcha/api/siteverify',
    minScore: Number(env.RECAPTCHA_MIN_SCORE || 0.5),
    action: 'sighting',
    hostnames: (env.RECAPTCHA_HOSTNAMES || '').split(',').map((s) => s.trim()).filter(Boolean),
  },

  rateLimit: { subscribePerIpPerHour: 5, optinPerPhonePerDay: 2 },
});

export default RIVER;
