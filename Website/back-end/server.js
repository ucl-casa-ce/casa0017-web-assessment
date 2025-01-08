#!/usr/bin/env node

//  SERVER
//  Author:  Xinming Feng, Vineeth Kirandumkara
//  Description:  WHAT DOES THIS PACKAGE DO
//  Version: 0.0.1
//
//  Notes:   Any notes we need to know about the server     

//  Install Instructions
//      npm install moment mysql express ejs ....  
//         OR Groups will get more credit if they use
//      npm install and npm start shortcuts and include a package.json file
//          - See https://docs.npmjs.com/creating-a-package-json-file

import express from 'express';
import fs from 'fs';
import csv from 'csv-parser';
import path from 'path';
import dotenv from 'dotenv';
import cors from 'cors';

import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Enable cors for all origins.
  // Look into removing this when backend is pushed to PiCloud
app.use(cors());

const csvDirectory = path.join(__dirname, './csv_files');

// read files in floder
const csvFiles = fs.readdirSync(csvDirectory).filter(file => file.endsWith('.csv'));

// Create the corresponding API route for each CSV file
csvFiles.forEach(file => {
  const routePath = `/api/${path.basename(file, '.csv')}`;
  app.get(routePath, (req, res) => {
    const data = [];
    fs.createReadStream(path.join(csvDirectory, file))
      .pipe(csv())
      .on('data', (row) => {
        data.push(row);
      })
      .on('end', () => {
        res.json(data);
      })
      .on('error', (err) => {
        res.status(500).send(`settle documents ${file} error: ${err.message}`);
      });
  });
});

/**
 * Description: Access the API Key
 * TODO: Swap out Steven's API key for my own
 */
app.get('/api/key', (req, res)=>{
  res.json({apiKey: process.env.GMAP_API_KEY_S});
});

app.listen(port, '0.0.0.0', () => {
  console.log(`The server is running, listening for ports ${port}`);
  console.log('Available API routes:');
  csvFiles.forEach(file => {
    const routePath = `/api/${path.basename(file, '.csv')}`;
    console.log(`- ${routePath}`);
  });
});