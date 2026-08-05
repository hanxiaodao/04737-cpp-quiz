// IndexedDB 封装：答题历史记录存储
// 数据库 cpp_quiz / objectStore history（keyPath: id 自增）
// 记录结构: { id, qid, qtype, correct, answer, ts, duration }
// 说明: 答题历史明细存 IndexedDB（容量大、可索引），
//       进度/错题/收藏等轻量数据仍在 localStorage（app.js 同步读写）。
(function () {
  'use strict';

  var DB_NAME = 'cpp_quiz';
  var DB_VERSION = 1;
  var STORE = 'history';

  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }

      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('ts', 'ts');
          store.createIndex('qid', 'qid');
        }
      };

      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
    });

    return dbPromise;
  }

  function withStore(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try {
          tx = db.transaction(STORE, mode);
        } catch (e) {
          reject(e);
          return;
        }
        var store = tx.objectStore(STORE);
        var req;
        try {
          req = fn(store);
        } catch (e) {
          reject(e);
          return;
        }
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // 新增一条历史记录（id 由 IDB 自增）
  function add(rec) {
    return withStore('readwrite', function (store) {
      return store.add(rec);
    });
  }

  // 获取全部记录（按时间倒序），可选 limit
  function getAll(limit) {
    return withStore('readonly', function (store) {
      return store.getAll();
    }).then(function (arr) {
      var list = (arr || []).slice();
      list.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      return limit ? list.slice(0, limit) : list;
    });
  }

  // 记录总数
  function count() {
    return withStore('readonly', function (store) {
      return store.count();
    });
  }

  // 清空全部历史
  function clear() {
    return withStore('readwrite', function (store) {
      return store.clear();
    });
  }

  // 静默写入：判定点 fire-and-forget 用，任何失败（隐私模式/不支持）都不抛错
  function safeAdd(rec) {
    try {
      return Promise.resolve(add(rec)).catch(function () {});
    } catch (e) {
      return Promise.resolve();
    }
  }

  var api = { open: open, add: add, getAll: getAll, count: count, clear: clear, safeAdd: safeAdd };

  if (typeof window !== 'undefined') window.QuizIDB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
