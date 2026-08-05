import { readFileSync } from 'fs';
import { checkQuestions } from './validate-lib.mjs';

const file = process.argv[2];

if (!file) {
  console.error('用法: node tools/validate.mjs data/questions/sample.json');
  process.exit(1);
}

const raw = readFileSync(file, 'utf8');
const data = JSON.parse(raw);

const questions = Array.isArray(data) ? data : data.questions;

if (!Array.isArray(questions)) {
  console.error('错误：JSON 中必须包含 questions 数组');
  process.exit(1);
}

const { errors, warnings } = checkQuestions(questions);

warnings.forEach(w => console.error(`警告：${w}`));

if (errors.length) {
  errors.forEach(e => console.error(`错误：${e}`));
  process.exit(1);
}

console.log('校验通过：', file);
