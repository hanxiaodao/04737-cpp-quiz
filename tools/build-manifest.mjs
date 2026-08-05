import { readdirSync, writeFileSync } from 'fs';

const dir = 'data/questions';

const files = readdirSync(dir)
  .filter(file => file.endsWith('.json'))
  .sort()
  .map(file => `data/questions/${file}`);

const manifest = { files };

writeFileSync('data/manifest.json', JSON.stringify(manifest, null, 2));

console.log('manifest.json 已更新，共加载题库文件：', files.length);
