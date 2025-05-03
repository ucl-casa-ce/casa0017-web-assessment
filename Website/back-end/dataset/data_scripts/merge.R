library(dplyr)
library(readr)

merge_csv <- function(weather_file, collision_file, output_file) {
  # 读取数据
  weather_data <- read_csv(weather_file)
  collision_data <- read_csv(collision_file)

  # 根据日期合并数据
  merged_data <- left_join(weather_data, collision_data, by = "date")

  # 将合并后的数据写入新的CSV文件
  write_csv(merged_data, output_file)
}

# 使用示例
merge_csv("london_weather_data_2013_2023.csv", "collisions_merged.csv", "merged.csv")