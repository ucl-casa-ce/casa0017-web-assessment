// TODO: Import pool

export const getTidalReadings = async (hours = 24) => {
  // TODO: SELECT readings WHERE reading_type = 'tide' AND timestamp in range
};

export const getRainfallReadings = async (hours = 24, gaugeId = null) => {
  // TODO: SELECT readings WHERE reading_type = 'rainfall' AND timestamp in range
  // TODO: Filter by gauge_id if provided
};

export const insertReading = async (readingData) => {
  // TODO: INSERT INTO readings
};

export const getReadingsByTimeRange = async (startTime, endTime, readingType = null) => {
  // TODO: SELECT readings WHERE timestamp BETWEEN ? AND ?
  // TODO: Filter by reading_type if provided
};

export const getLatestReading = async (readingType) => {
  // TODO: SELECT latest reading WHERE reading_type = ?
};
