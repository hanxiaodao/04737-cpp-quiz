#!/usr/bin/env node
/**
 * update.mjs — 题库更新脚本
 *
 * 用法：
 *   node tools/update.mjs              # 校验全部题库 + 重建 data/manifest.json（本地，不提交）
 *   node tools/update.mjs --deploy     # 校验通过后 git 提交并推送 master（自动触发 GitHub Actions 部署）
 *
 * 流程：扫描 data/questions/*.json → 逐文件校验（复用 validate-lib.mjs）→ 重建 manifest.json
 *       → （--deploy）提交推送，触发站点自动部署。
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { checkQuestions } from './validate-lib.mjs';

const DIR = 'data/questions';
const MANIFEST = 'data/manifest.json';
const deploy = process.argv.includes('--deploy');

// ---------- 1. 校验全部题库 ----------
const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
let fail = 0;

for (const f of files) {
  const path = join(DIR, f);
  let questions;

  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    questions = Array.isArray(data) ? data : data.questions;
  } catch (err) {
    console.error(`[失败] ${f}: JSON 解析错误 - ${err.message}`);
    fail++;
    continue;
  }

  if (!Array.isArray(questions)) {
    console.error(`[失败] ${f}: JSON 中必须包含 questions 数组`);
    fail++;
    continue;
  }

  const { errors, warnings } = checkQuestions(questions);
  warnings.forEach(w => console.warn(`[警告] ${f}: ${w}`));

  if (errors.length) {
    errors.forEach(e => console.error(`[失败] ${f}: ${e}`));
    fail++;
  } else {
    console.log(`[通过] ${f}（${questions.length} 题）`);
  }
}

if (fail) {
  console.error(`\n更新中止：${fail} 个题库文件未通过校验，请先修复。`);
  process.exit(1);
}

// ---------- 2. 重建 manifest.json ----------
const manifest = { files: files.map(f => `data/questions/${f}`) };
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

console.log(`\nmanifest.json 已更新，共加载题库文件：${files.length}`);

// ---------- 3. --deploy：提交并推送，触发部署 ----------
if (!deploy) {
  console.log('本地模式完成（未提交）。确认无误后运行: node tools/update.mjs --deploy');
  process.exit(0);
}

const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (!dirty) {
  console.log('工作区无变更，无需提交。');
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
execFileSync('git', ['add', '-A'], { stdio: 'inherit' });
execFileSync('git', ['commit', '-m', `update: 题库更新（${date}）`], { stdio: 'inherit' });
execFileSync('git', ['push', 'origin', 'master'], { stdio: 'inherit' });

console.log('已推送至 master，GitHub Actions 将自动部署站点。');
