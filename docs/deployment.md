# Render 部署

点击下面按钮即可部署到 Render：

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/basketikun/infinite-canvas)

## 部署步骤

1. 点击 `Deploy to Render`。
2. 登录 Render，并按页面提示连接 GitHub。
3. 填写 `ADMIN_PASSWORD`，然后点击确认部署。

部署完成后，打开 Render 分配的 `.onrender.com` 域名即可访问。

## 免费版说明

默认使用 Render 免费 Web Service：

- 空闲约 15 分钟后会休眠，下次访问会自动唤醒。
- 必须配置外部 MySQL 或 PostgreSQL，免费实例的本地文件不用于数据库存储。
- 适合体验和演示，不适合长期保存正式数据。

如果要长期使用，建议使用托管 MySQL 或 PostgreSQL，并按实际并发选择数据库规格。

## 管理员账号

默认管理员用户名：

```text
admin
```

管理员密码是在 Render 部署页面里填写的 `ADMIN_PASSWORD`。
