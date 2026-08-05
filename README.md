# 04737 C++ 程序设计 真题刷题

自考 04737《C++ 程序设计》历年真题在线刷题（纯静态，无后端，GitHub Pages 部署）。

## 功能

- 历年真题标准化题库（选择题 / 填空题 / 程序阅读题 / 编程题）
- 答题与判分，编程题附参考答案
- 答题历史本地存储（IndexedDB），支持清空
- 首页学习统计、答题历史页
- PWA 离线可用（Service Worker）

## 在线地址

https://hanxiaodao.github.io/04737-cpp-quiz/

## 本地预览

```bash
python -m http.server 8000
```

## 更新题库

新增或修改 `data/questions/*.json` 后，运行更新脚本（校验全部题库 + 重建 `data/manifest.json`）：

```bash
node tools/update.mjs               # 本地模式：只校验和重建 manifest，不提交
node tools/update.mjs --deploy      # 校验通过后自动提交并推送 master（触发部署）
```

单项校验可单独使用：

```bash
node tools/validate.mjs data/questions/2026-04.json
```

## 部署

推送至 `master` 分支即自动触发 GitHub Actions 部署至 Pages（见 `.github/workflows/deploy.yml`）。
