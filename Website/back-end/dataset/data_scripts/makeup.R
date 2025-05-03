library(dplyr)
library(readr)
library(lubridate)

# 读取数据
collisions <- read_csv("collisions_merged.csv")

# 确保 date 列是日期类型
collisions$date <- ymd(collisions$date)

# 创建完整日期序列
start_date <- ymd("2013-01-01")
end_date <- ymd("2023-12-31")
full_dates <- seq(start_date, end_date, by = "day")
full_dates_df <- data.frame(date = full_dates)

# 使用 full_join 补全日期，并填充缺失值
collisions_full <- full_join(full_dates_df, collisions, by = "date") %>%
  mutate(CollisionCount = ifelse(is.na(CollisionCount), 0, CollisionCount))

# 检查补全后的数据
print("补全后的数据结构:")
glimpse(collisions_full)
print(paste("补全后的数据行数:", nrow(collisions_full)))

# 保存补全后的数据
write_csv(collisions_full, "collisions_full.csv")

print("数据已保存到 collisions_full.csv")