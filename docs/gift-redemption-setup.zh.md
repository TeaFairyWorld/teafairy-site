# 致谢礼物兑换：主人设置说明

本说明给 TeaFairy 负责人使用。页面是双语的（英语 / 中文），用来让 **20 位**已经拿到一次性兑换码的人，在我们自己的网站上填写收货地址。TeaFairy 再按后台记录寄出礼物。页面不会自动下单给快递，也不会发邮件。

这次环境读得到网站仓库 `TeaFairyWorld/teafairy-site`，读不到 `TeaFairyWorld/teatok`（GitHub 返回仓库不存在 / 当前令牌无权访问）。因此迁移和 Edge Function 先放在网站仓库的 `supabase/` 目录，方便有 teatok 写权限的人原样迁入后再单独开一个 PR。**不要把本仓库合并进 teatok，也不要在合并网站 PR 时认为数据库已经上线。** 本次没有对线上 Supabase、GitHub Pages 或生产密钥做任何更改。

## 1. 现有架构（已核对，不是假设）

- 网站是 GitHub Pages 静态站，自定义域名为 `teafairyworld.co.uk`。
- 现有 `admin/index.html` 用公开的 anon key 登录 Supabase 项目 `lqghuvaazdnqzkbagbay`，再根据 `profiles.is_admin` 决定是否显示后台。礼物后台沿用这个登录，不在 JavaScript 里放密码。
- 礼物表和函数与现有 `orders`、课程兑换码、`/r/CODE` 推荐码分开。anon / authenticated 对礼物表没有权限，也不能直接列出地址。地址只经过 Edge Function，用 service role 在数据库事务里写入。

## 2. 要迁入 teatok 的文件

- `supabase/migrations/20261106120000_gift_redemption.sql`
- `supabase/functions/_shared/gift_logic.ts`
- `supabase/functions/_shared/gift_http.ts`
- `supabase/functions/_shared/gift_store_supabase.ts`
- `supabase/functions/gift-redeem/index.ts`
- `supabase/functions/gift-admin/index.ts`
- `supabase/config.gift-functions.toml`（合并进 teatok 现有的 `config.toml`，不要覆盖整个文件）
- `scripts/generate-gift-codes.mjs`
- `scripts/provision-gift-codes.mjs`

合并后的函数配置应为：

- `gift-redeem`：`verify_jwt = false`。领礼物的人没有 App 账号。网关仍会要求公开的 anon key，这不是管理员授权。
- `gift-admin`：`verify_jwt = true`，函数内再查 `profiles.is_admin`。

## 3. 上线前要由主人完成的配置（本次未执行）

在 Supabase 项目的 Edge Function secrets 中设置，不要写入 git：

```
GIFT_CODE_PEPPER=
GIFT_ALLOWED_ORIGINS=https://teafairyworld.co.uk,https://www.teafairyworld.co.uk
```

`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_ANON_KEY` 由 Supabase 注入函数。service role 只留在服务器和你自己的灌码电脑上。

建议顺序：

1. 把 SQL 迁移应用到该 Supabase 项目。活动默认是 **关闭** 的（`active = false`）。
2. 部署 `gift-redeem` 和 `gift-admin`。
3. 设置上面的 pepper 和允许的来源。pepper 一旦更换，已灌入的哈希全部失效，需要重新灌码，且只能在还没有人兑换时这样做。
4. 私下生成并灌入正好 20 个兑换码（见下一节）。
5. 用已有管理员账号打开网站后台的 Gifts 页，确认能看到空列表。
6. 确认函数可用后，再合并并发布网站。若先发布网页、后部署函数，页面仍可阅读，提交会提示服务尚未接通，不会假装成功。
7. 准备让客人兑换时，在 Gifts 页勾选 “Accept redemptions”。

本地检查（不会连上生产库）可以用：

```
npm test
npm run dev:gift
```

本地服务器只接受名称里带 `TEST-ONLY` 的测试 pepper，并只监听 `127.0.0.1`。

## 4. 如何私下准备 20 个兑换码

不要把兑换码写进 git、README、PR、截图、网页或聊天记录。也不要做成 `teafairyworld.co.uk/r/某码` 或任何带兑换码的网址。现有 404 页会把 `/r/` 后面最多 20 个字符当成推荐码。生成器产出的是 23 个字符，避免被这条旧逻辑收下。

在仓库外的私人目录：

```
GIFT_CODES_OUT=/安全的/仓库外/路径/gift-codes.txt node scripts/generate-gift-codes.mjs
```

脚本拒绝把文件写进本仓库，也不会在终端打印兑换码。

然后在私人 shell 中（不要把这条命令写进仓库）：

```
export SUPABASE_URL=https://lqghuvaazdnqzkbagbay.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=（只在本机）
export GIFT_CODE_PEPPER=（与函数 secret 相同）
export REDEEM_CODES="$(cat /安全的/仓库外/路径/gift-codes.txt)"
node scripts/provision-gift-codes.mjs
```

成功时终端只显示灌入条数和总数，例如 `provisioned inserted=20 total=20`。数据库里只保存 HMAC-SHA256，不保存明文。灌完后删除那份私人文件。把 20 个码通过你们自己的安全渠道交给组织者，由组织者发给 20 位客人。每个码只能成功使用一次。

`.env.example` 里的 `REDEEM_CODES=` 是空的，这是故意的。

## 5. 客人如何兑换

客人打开 `redeem.html`（导航里的 Gift，首页也有一段说明）：

1. 输入兑换码。
2. 填写收件人、地址、城市、邮编、国家（默认英国），电话和邮箱可选，备注可选。
3. 勾选只用于寄送礼物和配送联系的同意，并可以打开隐私政策第 11 节。
4. 一次提交。服务器在同一个数据库事务里核对哈希并写入地址。

兑换码不会出现在网址、查询字符串或浏览器本地存储里。失败的地址校验、未开放、超过截止日期、不允许的国家，都不会把码标记为已使用。只有整笔提交成功才算用掉。

成功后页面只给出确认编号，形如 `TF-` 加 8 位十六进制。不回显地址，也不回显兑换码。无效、已使用、已过期使用同一句说明，避免别人靠不同报错试出码是否有效。

## 6. 主人如何查看和标记发货

使用已经是 `profiles.is_admin` 的账号登录现有后台，打开 **Gifts**。

这里可以看到确认编号、地址和状态 `pending_shipment`。核对后填写承运方和单号（可选），点 “Mark as shipped”。这只把状态改为 `shipped`，不会发邮件，也不会向快递下单。

可在同一页设置（都不是必须立刻填写的文案）：

| 项目 | 留空时页面上的说法 |
| --- | --- |
| 是否开放兑换 | 不开放时提交会说明尚未开放，兑换码不会被用掉 |
| 截止日期（UTC） | “尚未设定” |
| 可寄送国家 | “本页尚未限制” |
| 发货后多少天删除地址 | 默认 90，见下文 |
| 礼品名称、尺寸 | 页面保持 “二十份致谢礼物中的一份”，不要在这里编造 |

频率限制也可以在 `gift_campaign` 里调整，默认大约是：同一 IP 每 15 分钟 10 次、每天 30 次，同一个码每小时 5 次。次数保存在 Postgres，多次函数实例之间仍然有效。

## 7. 保留与删除

建议：礼物标记为已发货之后 **90 天** 删除或清空收货信息。这是工作上的建议，方便你们配置，**不是**对某条法定期限的承诺。后台按钮 “Remove delivery details past this period” 会调用 `gift_admin_redact_due()`，只处理已经发货且超过该天数的记录。确认编号和已发货状态会留下，地址、电话、邮箱和备注会被清空。

系统没有自动定时任务。不点这个按钮，记录就会继续留着。客人也可以写信到 hello@teafairyworld.co.uk 要求更早删除。

## 8. 隐私政策里已经写上的内容

`privacy.html` 第 11 节说明：

- 收集的是收件信息；电话、邮箱、备注可选。
- 不收集证件、年龄、学校、专业或简历。
- 用途只是寄送礼物和配送联系。
- 不是购买，不收集银行卡。
- 存储在你们已经在用的 Supabase 项目中，本次不新增托管商。快递只在真正寄出时拿到地址。
- 若以后更换托管商，应先改这一节再切换。
- 研究材料中出现的英中贸易协会、Pippa Ebel、Olivia Qian Zhu，不表示本网站是 CBBC 的官方页面。

## 9. 安全上做了什么，以及做不到什么

做了：

- 兑换码只以 HMAC 存在数据库里。比对是按哈希查找，而不是在应用里逐个提前返回。20 条记录的索引查找，不能承诺和手写的常量时间循环完全一样；频率限制和高熵兑换码用来挡住试探。
- 同一码并发提交时，数据库 `for update` 保证只有一笔成功。
- 地址写入失败会整笔回滚，兑换码保持可用。
- 不把地址放进 GET、查询字符串、前端存储、静态文件或我们自己写的日志。
- 管理列表在输出时转义 HTML。
- 跨站来源不在允许名单内时，提交会被拒绝。
- anon 即使被误授表权限，因为没有 RLS 策略，也读不到行。

限制（请按此理解，而不是当成已经完美）：

- GitHub Pages 不能给静态页加全套 HTTP 安全头。兑换页用了 `no-referrer` 和内容安全策略 meta。接口响应上有 `no-store`、`nosniff` 和来源限制。
- IP 限流依赖平台提供的 `cf-connecting-ip` 或 `x-forwarded-for` 第一段。若有人绕过页面直接调用函数并伪造该头，IP 限额可能被绕过。兑换码本身仍然必须猜中，生产码应使用生成器，不要用短码。
- Supabase 自己的函数日志是否记录请求体，由平台决定。我们的代码不打印兑换码和地址。请不要额外打开记录请求体的调试日志。
- 若客人的网络在服务器已保存之后才断开，再次提交会看到 “无法兑换”。此时码已经用掉，后台能看到记录。页面文案请他们发邮件，而不是反复尝试。
- 没有接验证码服务。频率限制是主要的自动刹车。
- 后台能看到地址，因为要发货。没有做未登录导出，也没有把地址放进 CSV。

## 10. 页面范围与标志

公开页面只有 `redeem.html`：TeaFairy 标志、简短说明、兑换码和收货表（姓名、电话、地址、城市、邮编、国家）。导航里有一个 Gift 链接。首页没有活动大段。没有会员、购物车或新的营销流程。

英中贸易协会的标志：仓库和本次上传文件里都没有主人提供的授权图档。页面因此只用文字写「英中贸易协会」，没有自制或下载标志，也不表示 CBBC 背书。请主人把授权标志文件发来后再加到页面上。不要把未授权图片放进 git。

## 11. 尚未由主人决定、因此页面保持中性的事项

这些不阻止现在的代码，但上线文案若要写具体，需要你们定：

1. 20 份礼物具体是什么（不要在确认前写名称或规格）。
2. 有没有不能寄送的国家或地区。
3. 兑换截止日期。
4. 是否要在页面上写一个发货时间范围。
5. 确认仍使用现有 Supabase 项目 `lqghuvaazdnqzkbagbay` 存放这批新表。teatok 仓库本次无法提交 PR。

无需购买即可兑换。页面已写明。若将来改成必须购买，要先改文案，当前没有这种要求。
