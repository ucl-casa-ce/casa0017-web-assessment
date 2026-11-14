// TODO: Import pool

export const getEvents = async ({ startDate, endDate, limit = 100 }) => {
  // TODO: SELECT events with JOIN to outfalls
  // TODO: Apply date filters if provided
};

export const getActiveEvents = async () => {
  // TODO: SELECT events WHERE end_time IS NULL
};

export const getEventsByOutfall = async (outfallId, limit = 50) => {
  // TODO: SELECT events WHERE outfall_id = ?
};

export const insertEvent = async (eventData) => {
  // TODO: INSERT INTO events
};

export const updateEventEndTime = async (eventId, endTime) => {
  // TODO: UPDATE events SET end_time = ? WHERE id = ?
};

export const getEventById = async (eventId) => {
  // TODO: SELECT event WHERE id = ?
};
