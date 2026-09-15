#!/usr/bin/env node
/**
 * REWIS パスワードハッシュ生成ツール
 * 
 * 使用方法:
 *   node generate-hash.js
 *   
 * または、引数を指定：
 *   node generate-hash.js "my-password" "my-salt"
 */

const crypto = require('crypto');

const args = process.argv.slice(2);
const password = args[0] || 'replace-this-password';
const salt = args[1] || 'replace-with-random-long-string';

const text = password + salt;
const hash = crypto.createHash('sha256').update(text).digest('hex');

console.log('=== REWIS パスワードハッシュ生成 ===\n');
console.log(`Password: ${password}`);
console.log(`Salt:     ${salt}`);
console.log(`\nGenerated Hash:\n${hash}\n`);
console.log('このハッシュをAUTH_USERS_JSONのpasswordHashに設定してください。\n');

// 複数ユーザーの例を表示
console.log('--- 複数ユーザーの例 ---');
const exampleUsers = [
  { userId: 'admin', password: 'admin-password' },
  { userId: 'editor1', password: 'editor1-password' },
  { userId: 'editor2', password: 'editor2-password' }
];

const users = exampleUsers.map(u => {
  const h = crypto.createHash('sha256').update(u.password + salt).digest('hex');
  return { userId: u.userId, passwordHash: h };
});

console.log('AUTH_USERS_JSON に以下を設定してください：\n');
console.log(JSON.stringify(users, null, 2));
