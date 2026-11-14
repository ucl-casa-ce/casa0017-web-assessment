import { parseEdmReturns, validateOutfallData } from '../src/utils/parseEdmReturns.js';
import { insertOutfall } from '../src/db/queries/outfalls.queries.js';

// TODO: Accept CSV file path as command line argument

async function seedOutfalls() {
  // TODO: Parse EDM returns CSV file
  // TODO: Validate each outfall data
  // TODO: Insert valid outfalls into database
  // TODO: Log success/error counts
  // TODO: Close database connection
}

seedOutfalls();
