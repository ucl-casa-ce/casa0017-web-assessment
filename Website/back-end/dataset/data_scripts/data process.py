import json
from datetime import datetime
from collections import defaultdict

# 读取 JSON 数据文件
with open('c.json', 'r', encoding='utf-8') as file:
    data = json.load(file)

# 使用字典存储每日事故数
daily_accident_count = defaultdict(int)

# 遍历数据，处理时间戳
for key, value in data.items():
    # 提取时间戳并转换为日期
    timestamp = int(value.get("datetime", 0))
    date = datetime.utcfromtimestamp(timestamp).strftime('%Y-%m-%d')
    # 每日事故计数加1
    daily_accident_count[date] += 1

# 写入 CSV 文件
with open('daily_accident_summary.csv', 'w', encoding='utf-8') as file:
    file.write("date,accident_count\n")  # 写入表头
    for date, count in sorted(daily_accident_count.items()):
        file.write(f"{date},{count}\n")

print("数据已处理并保存为 daily_accident_summary.csv 文件。")
