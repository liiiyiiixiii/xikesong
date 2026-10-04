# 开发与首次运行

需要 Node.js 24。仓库根目录的脚本统一调用两个独立子项目，原有相对路径保持不变。

```sh
npm run install:all
npm run build
```

首次使用空数据库时，从 red-koala 目录依次应用迁移。不要对已存在的库重复执行全部迁移。

```sh
cd red-koala
for migration in drizzle/*.sql; do
  npx wrangler d1 execute DB --local --persist-to .wrangler/state --config dist/server/wrangler.json --file "$migration" || break
done
npm run dev
```

访问 http://127.0.0.1:5173。管理端 `/admin`，厨房端 `/kitchen`，智能分析 `/admin?view=intelligence`。
新克隆没有历史记录、设备配置、菜单或模型凭证。先在设备设置中配置菜品与秤。已有数据库的维护请按应用说明处理。

`.env.example` 只含空值/示例。开发启动自动生成本地调度与加密秘密；模型密钥在服务端设置，或通过页面连接。提交时不带这些秘密。

## 可复现演示与测试

启动和构建前自动生成固定种子的独立午餐演示静态数据。其输出不提交。测试中的午餐夹具在临时目录生成并清理。

```sh
npm test
npm run typecheck
npm run check:release
```

样例环境保留完整生成器和测试夹具：

```sh
cd sample-provider
npm run history:generate
npm run history:check
```

将合成历史导入应用会涉及备份及维护操作，按 [样例说明](../sample-provider/README.md) 和 [接口协议](../red-koala/docs/INTEGRATION.md) 进行；生成数据不等于已完成导入。源码文档中的既有运行状态仅描述开发环境，不代表新克隆状态。

浏览器脚本需要 Playwright 和匹配数据场景，见 [浏览器检查](../ui-preview/README.md)。真实设备、联网模型调用及数据导入不是本地单元测试所验证的范围。

## 本次整理

保留完整业务实现，包括画像、预测、LLM 提示词、称重事件处理、统计与界面。补充根目录开发命令、交付清单、CI、可复现演示夹具、可移植浏览器路径、视觉 README 与署名许可说明。原始开发项目没有被重写。

不上传 node_modules、Git 历史、运行数据库、.env 实值、备份、生成数据、缓存或日志。文档展示只选用经检查的演示截图，明确标注其合成/离线来源。PUBLIC_FILES.json 是完整源码交付文件清单；旧的 21 文件技术摘录已被替换。
