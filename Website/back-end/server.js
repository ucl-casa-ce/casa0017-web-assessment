const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

let weatherData = [];

fs.createReadStream('./back-end/weather_collisions_with_categlory_2013_2023.csv')
  .pipe(csv())
  .on('data', (row) => {
    weatherData.push(row);
  })
  .on('end', () => {
    console.log('CSV file loaded successfully.');
  });

app.use(express.static(path.join(__dirname, '../front-end')));


app.get('/api/weather', (req, res) => {
  const { date } = req.query;

  const formattedDate = date
    .split('-')
    .map((part, index) => (index === 0 ? part : String(Number(part))))
    .join('/');

  // 查询 CSV 数据
  const result = weatherData.find((entry) => entry.date === formattedDate);

  if (result) {
    res.json(result);
  } else {
    res.status(404).send('Data not found for the selected date.');
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../front-end/analyse.html'));
});


const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
