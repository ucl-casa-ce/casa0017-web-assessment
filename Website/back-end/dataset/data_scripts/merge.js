const fs = require('fs');
const csv = require('csv-parser');

async function mergeCSV(weatherFile, collisionFile, outputFile) {
  const weatherData = [];
  const collisionData = [];

  // 读取天气数据
  await new Promise((resolve, reject) => {
    fs.createReadStream(weatherFile)
      .pipe(csv())
      .on('date', (row) => weatherData.push(row))
      .on('end', resolve)
      .on('error', reject);
  });

  // 读取碰撞数据
  await new Promise((resolve, reject) => {
    fs.createReadStream(collisionFile)
      .pipe(csv())
      .on('data', (row) => collisionData.push(row))
      .on('end', resolve)
      .on('error', reject);
  });

  const mergedData = [];

  // 使用日期进行合并
  for (const weatherRow of weatherData) {
    const collisionRow = collisionData.find((c) => c.date === weatherRow.date);
    if (collisionRow) {
      mergedData.push({ ...weatherRow, collisionCount: collisionRow.collisionCount });
    } else {
        // 如果没有找到匹配的碰撞数据，可以选择保留天气数据，并将碰撞计数设置为 null 或其他默认值
        mergedData.push({ ...weatherRow, collisionCount: null });
    }
  }

  // 将合并后的数据写入新的CSV文件
  const createCsvWriter = require('csv-writer').createObjectCsvWriter;
  const header = Object.keys(mergedData[0]).map(key => ({id: key, title: key}));

    const csvWriter = createCsvWriter({
        path: outputFile,
        header: header
    });
    
    csvWriter.writeRecords(mergedData)       // returns a promise
        .then(() => {
            console.log('...Done');
        });

}

// 使用示例
mergeCSV('london_weather_data_2013_2023.csv', 'collisions_merged.csv', 'merged.csv');