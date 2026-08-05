// 同步 coding 题的 answer → referenceLines，并修正 4 道题的参考答案
// 用法: node tools/sync-coding-refs.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'data/questions';
const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();

// 修正后的参考答案（基于原 answer 审阅修正）
const FIXED = {
  // 202304-46: 增加文件打开失败检查
  '202304-46': `#include<iostream>
#include<fstream>
#include<string>
using namespace std;
int main(){
 ifstream in("dev1.cpp");
 if(!in){ cout<<"打开dev1.cpp失败"<<endl; return 1; }
 ofstream out("dev2.txt");
 string line;
 int no=1;
 while(getline(in,line)){ out<<no<<" "<<line<<endl; no++; }
 in.close(); out.close();
 return 0;
}`,
  // 202310-47: 增加文件打开失败检查
  '202310-47': `#include<iostream>
#include<fstream>
using namespace std;
int main(){
 int n; cin>>n;
 ifstream in("data.txt");
 if(!in){ cout<<"打开data.txt失败"<<endl; return 1; }
 int *a=new int[n];
 for(int i=0;i<n;i++){ in>>a[i]; cout<<a[i]<<" "; }
 cout<<endl;
 for(int i=0;i<n-1;i++){
  for(int j=0;j<n-1-i;j++){
   if(a[j]>a[j+1]){
    int t=a[j]; a[j]=a[j+1]; a[j+1]=t;
   }
  }
 }
 ofstream out("res.txt");
 for(int i=0;i<n;i++) out<<a[i]<<" ";
 delete[] a;
 return 0;
}`,
  // 202404-46: 增加文件打开失败检查
  '202404-46': `#include<fstream>
#include<iostream>
using namespace std;
int main(){
 ifstream in("C:/f1.txt", ios::in|ios::binary);
 if(!in){ cout<<"打开f1.txt失败"<<endl; return 1; }
 ofstream out("D:/f2.txt", ios::out|ios::binary);
 char ch;
 while(in.read(&ch,1)){ out.write(&ch,1); }
 in.close(); out.close();
 return 0;
}`,
  // 202410-41: lambda 改普通比较函数（自考教材不含 C++11 lambda）
  '202410-41': `#include<iostream>
#include<fstream>
#include<vector>
#include<algorithm>
using namespace std;
struct Stu{ string name; int score; };
bool cmp(const Stu &a, const Stu &b){ return a.score>b.score; }
int main(){
 ifstream in("C:/score.txt");
 ofstream out("out.txt");
 vector<Stu> v; string name; int score;
 while(in>>name>>score){ v.push_back(Stu{name,score}); cout<<name<<' '<<score<<endl; }
 sort(v.begin(),v.end(),cmp);
 for(int i=0;i<(int)v.size();i++) out<<v[i].name<<' '<<v[i].score<<endl;
 return 0;
}`,
};

let fixedCount = 0;
for (const f of files) {
  const path = join(dir, f);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  let changed = false;

  for (const q of data.questions) {
    if (q.type !== 'coding') continue;
    let answer = q.answer || '';

    if (FIXED[q.id]) {
      answer = FIXED[q.id];
      changed = true;
      console.log(`[修正] ${q.id} (${f}) 已替换参考答案`);
      fixedCount++;
    }

    // 同步 referenceLines（前端渲染字段）
    if (!(q.referenceLines || []).length && answer.trim()) {
      q.referenceLines = answer.replace(/\r\n/g, '\n').split('\n');
      q.reference = undefined; // 旧字段清掉，统一用 referenceLines
      changed = true;
      console.log(`[同步] ${q.id} (${f}) answer → referenceLines (${q.referenceLines.length} 行)`);
    }
  }

  if (changed) {
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }
}

console.log(`\n完成：修正 ${fixedCount} 题，同步参考代码。`);
