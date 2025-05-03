// collisionsExport.js
const axios = require('axios');
const fs = require('fs');

(async () => {
  try {
    // 1) 配置参数
    const cycleStreetsApiKey = '655a7d85703df57d';
    // 大伦敦
    const bbox = '-0.489,51.261,0.236,51.655';
    // 2016 年 1 月 1 日 ~ 12 月 31 日
    const since = '2017-07-01';
    const until = '2017-12-31';
    // 只要轻伤、并且伤者包含 cyclist
    const severity = 'slight';
    const casualtiesinclude = 'cyclist';
    // 每页最大条数
    const limit = 2000;

    // 2) 第一次请求，先获取 totalPages
    let page = 1;
    const collisionsAll = {}; 
    // 注意：当 format=flat 时，数据在 data.data[...] 而不是 data.features[...]

    // 定义一个函数，抓某一页数据
    async function fetchOnePage(p) {
      const url = `https://api.cyclestreets.net/v2/collisions.locations`
        + `?key=${cycleStreetsApiKey}`
        + `&bbox=${bbox}`
        + `&since=${since}`
        + `&until=${until}`
        + `&limit=${limit}`
        + `&page=${p}`
        + `&casualtiesinclude=${casualtiesinclude}`
        + `&field:severity=${severity}`
        + `&datetime=sqldatetime`
        + `&format=flat`;  // 关键：flat

      console.log(`Requesting page=${p}: ${url}`);
      const { data } = await axios.get(url);

      if (!data || !data.data) {
        throw new Error('No data.data in response. Possibly an error from API.');
      }

      // data.pagination 里有 page / totalPages / totalAvailable
      return data;
    }

    // 第一次请求，拿到 pagination 信息
    let firstPageData = await fetchOnePage(page);
    const totalPages = firstPageData.pagination.totalPages;
    console.log(`Total pages: ${totalPages}`);

    // 把第一页的数据先记录下来
    Object.assign(collisionsAll, firstPageData.data);

    // 如果 totalPages > 1，就继续请求后续页面
    for (let p = 2; p <= totalPages; p++) {
      let pageData = await fetchOnePage(p);
      // 合并
      Object.assign(collisionsAll, pageData.data);
    }

    // 3) 到这里 collisionsAll 已包含本次所有 collisions
    // 当 format=flat 时, data 结构大概是:
    //  {
    //    "201635AB0123": {
    //       id: "201635AB0123",
    //       datetime: "2016-01-01 12:15:00",
    //       severity: "slight",
    //       ...
    //    },
    //    "201635AB0456": {...},
    //    ...
    //  }
    // 注意 key 是 collision id

    const allKeys = Object.keys(collisionsAll);
    console.log(`Total collisions fetched: ${allKeys.length}`);

    // =========== 按天统计 ===========
    const dailyCounts = {}; // key=YYYY-MM-DD, val=number

    for (let key of allKeys) {
      const collision = collisionsAll[key];
      if (!collision) continue;
      // e.g. collision.datetime = "2016-01-01 12:15:00"
      const dtStr = collision.datetime || '';
      const datePart = dtStr.split(' ')[0]; // "2016-01-01"
      if (!datePart) continue;

      if (!dailyCounts[datePart]) {
        dailyCounts[datePart] = 0;
      }
      dailyCounts[datePart]++;
    }

    // =========== 导出 CSV ===========
    // 排序
    const sortedDates = Object.keys(dailyCounts).sort();
    let csvStr = 'Date,CollisionCount\n';
    for (let d of sortedDates) {
      csvStr += `${d},${dailyCounts[d]}\n`;
    }

    fs.writeFileSync('collisions_2017_2_london_slight_cyclist.csv', csvStr, 'utf8');
    console.log('CSV file created');

  } catch (err) {
    console.error('Error:', err);
  }
})();
