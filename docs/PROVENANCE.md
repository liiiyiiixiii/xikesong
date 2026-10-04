# 来源与变更

本副本由同一项目工作区中的以下通用代码抽取，不携带源仓库历史。

| 公开文件 | 来源 | 处理 |
| --- | --- | --- |
| `src/domain/types.ts` | `sample-provider/lib/types.ts` | 仅抽取 Catalog、StoreDay、DishDay、Dataset；排除模型及其特征定义 |
| `src/domain/dataset.ts` | `sample-provider/lib/contract.ts` | 抽取 schema、业务校验；目录查找改为 Map |
| `src/adapters/csv.ts` | 同上 | 抽取 CSV 与数值解析 |
| `src/adapters/history-csv.ts` | 同上 | 抽取格式转换，显式依赖领域契约 |
| `src/domain/menu.ts` | `red-koala/lib/scales/menu.ts` | 仅抽取菜单过滤，采用最小结构类型 |

应用入口、服务接口、不可用预测适配器、合成示例、测试与公开检查脚本均为本公开版新增。类型脚本重新排版以方便评审。未声称这些抽取已经反向应用到完整项目。
