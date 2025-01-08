import fetch from 'node-fetch';
import fs from 'fs';
import { parse } from 'json2csv';

const API_URL = 'https://records-ws.nbnatlas.org/occurrences/search';
const SPECIES_LIST = ['Cygnus olor',
                      'Anas platyrhynchos',
                      'Lagopus muta',
                      'Phasianus colchicus',
                      'Ardea cinerea',
                      'Falco peregrinus',
                      'Passer domesticus',
                      'Scolopax rusticola',
                      'Milvus milvus']; // List of endangered animal species
const LONDON_LATITUDE = 51.5074;
const LONDON_LONGITUDE = -0.1278;
const RADIUS_KM = 50; 

async function fetchSpeciesData(scientificName) {
  const url = `${API_URL}?q=taxon_name:"${encodeURIComponent(scientificName)}"&lat=${LONDON_LATITUDE}&lon=${LONDON_LONGITUDE}&radius=${RADIUS_KM}&pageSize=1000`;
  console.log(`Fetching URL: ${url}`);

  const response = await fetch(url);
  console.log(`Response status: ${response.status}`);
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Response body: ${errorText}`);
    throw new Error(`Failed to fetch data for ${scientificName}: ${response.statusText}`);
  }
  const data = await response.json();
  console.log(`Full API response for ${scientificName}:`, JSON.stringify(data, null, 2)); // Output complete response
  const records = data.occurrences || data.results || [];
  console.log(`Number of records for ${scientificName}: ${records.length}`);
  return records;
}

async function saveDataToCSV(species, data) {
  if (data.length === 0) {
    console.log(`No data available for ${species}. Skipping CSV generation.`);
    return;
  }
  const fields = ['scientificName', 'vernacularName', 'decimalLatitude', 'decimalLongitude', 'eventDate', 'stateProvince', 'country'];
  const csv = parse(data, { fields });
  const filePath = `./${species.replace(/ /g, '_')}_distribution.csv`;
  fs.writeFileSync(filePath, csv);
  console.log(`Data saved to ${filePath}`);
}

async function main() {
  for (const species of SPECIES_LIST) {
    try {
      console.log(`Fetching data for ${species}...`);
      const data = await fetchSpeciesData(species);
      await saveDataToCSV(species, data);
    } catch (err) {
      console.error(`Error fetching data for ${species}:`, err.message);
    }
  }
}

main();
