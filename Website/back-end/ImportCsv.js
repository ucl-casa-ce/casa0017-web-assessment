import fs from 'fs';
import csv from 'csv-parser';
import pool from './mysql.js';

const insertRow = (row) => {
  return new Promise((resolve, reject) => {
    const query = 'INSERT INTO your_table SET ?';
    pool.query(query, row, (err, res) => {
      if (err) {
        return reject(err);
      }
      resolve(res.insertId);
    });
  });
};

const processCSV = async () => {
  const rows = [];
  fs.createReadStream('./Cygnus_olor_distribution.csv')
    .pipe(csv())
    .on('data', (row) => {
      rows.push(row);
    })
    .on('end', async () => {
      console.log('After reading the CSV file, insert data.');
      try {
        for (const row of rows) {
          const insertId = await insertRow(row);
          console.log('Insert row ID:', insertId);
        }
        console.log('All data is inserted.');
      } catch (error) {
        console.error('Error inserting data:', error);
      } finally {
        pool.end((err) => {
          if (err) {
            console.error('error occurred closing the connection pool:', err);
          } else {
            console.log('pool closed');
          }
        });
      }
    });
};

processCSV();
