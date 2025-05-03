// mergeCsv.js
const fs = require('fs');
const path = require('path');


const csvFiles = [
	'collisions_2013_1_london_slight_cyclist.csv',
    'collisions_2013_2_london_slight_cyclist.csv',
	'collisions_2014_1_london_slight_cyclist.csv',
    'collisions_2014_2_london_slight_cyclist.csv',
	'collisions_2015_1_london_slight_cyclist.csv',
    'collisions_2015_2_london_slight_cyclist.csv',
	'collisions_2016_1_london_slight_cyclist.csv',
    'collisions_2016_2_london_slight_cyclist.csv',
    'collisions_2017_1_london_slight_cyclist.csv',
    'collisions_2017_2_london_slight_cyclist.csv',
    'collisions_2018_1_london_slight_cyclist.csv',
    'collisions_2018_2_london_slight_cyclist.csv',
    'collisions_2019_1_london_slight_cyclist.csv',
    'collisions_2019_2_london_slight_cyclist.csv',
    'collisions_2020_1_london_slight_cyclist.csv',
    'collisions_2020_2_london_slight_cyclist.csv',
    'collisions_2021_1_london_slight_cyclist.csv',
    'collisions_2021_2_london_slight_cyclist.csv',
    'collisions_2022_1_london_slight_cyclist.csv',
    'collisions_2022_2_london_slight_cyclist.csv',
    'collisions_2023_1_london_slight_cyclist.csv',
    'collisions_2023_2_london_slight_cyclist.csv',
];

// 目标输出文件名
const outputFile = 'collisions_merged.csv';

// 合并逻辑
(async () => {
  try {
    let mergedLines = [];
    
    // 手动写一个表头
    // 也可以在第一个文件读取后放进去，但我们知道表头统一就是 "Date,CollisionCount"
    mergedLines.push('Date,CollisionCount');

    for (const file of csvFiles) {
      // 读文件
      const content = fs.readFileSync(path.join(__dirname, file), 'utf8');
      // 按行拆分
      let lines = content.split('\n').map(line => line.trim()).filter(Boolean);

      // 如果文件有表头，就跳过第一行
      // lines[0] 应该是 "Date,CollisionCount"
      // 其余行才是数据
      lines = lines.slice(1); 
      // 把这些数据行加到 mergedLines
      mergedLines.push(...lines);
    }

    // 把 mergedLines 拼回字符串
    const outputContent = mergedLines.join('\n');
    // 写入最终文件
    fs.writeFileSync(outputFile, outputContent, 'utf8');

    console.log(`All CSVs merged into ${outputFile} successfully!`);
  } catch (err) {
    console.error('Error merging CSV files:', err);
  }
})();
