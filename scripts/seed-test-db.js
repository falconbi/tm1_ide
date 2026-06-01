'use strict'
// Creates a test SQLite database at /tmp/tm1_test.db with sample data
const Database = require('better-sqlite3')
const db = new Database('/tmp/tm1_test.db')

db.exec(`
  CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    region TEXT,
    currency TEXT DEFAULT 'USD'
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    description TEXT,
    type TEXT CHECK(type IN ('Revenue','Cost','Asset','Liability'))
  );

  CREATE TABLE IF NOT EXISTS actuals (
    id INTEGER PRIMARY KEY,
    entity_code TEXT,
    account_code TEXT,
    period TEXT,
    amount REAL
  );

  DELETE FROM entities;
  DELETE FROM accounts;
  DELETE FROM actuals;

  INSERT INTO entities VALUES (1,'E001','North America','NOAM','USD');
  INSERT INTO entities VALUES (2,'E002','Europe','EMEA','EUR');
  INSERT INTO entities VALUES (3,'E003','Asia Pacific','APAC','USD');

  INSERT INTO accounts VALUES (1,'REV001','Product Revenue','Revenue');
  INSERT INTO accounts VALUES (2,'REV002','Service Revenue','Revenue');
  INSERT INTO accounts VALUES (3,'COS001','Cost of Sales','Cost');
  INSERT INTO accounts VALUES (4,'OPX001','Operating Expenses','Cost');

  INSERT INTO actuals VALUES (1,'E001','REV001','2027-01',150000);
  INSERT INTO actuals VALUES (2,'E001','REV001','2027-02',162000);
  INSERT INTO actuals VALUES (3,'E001','REV002','2027-01',45000);
  INSERT INTO actuals VALUES (4,'E002','REV001','2027-01',98000);
  INSERT INTO actuals VALUES (5,'E002','COS001','2027-01',42000);
  INSERT INTO actuals VALUES (6,'E003','REV001','2027-01',75000);
  INSERT INTO actuals VALUES (7,'E003','OPX001','2027-01',31000);
`)

console.log('Created /tmp/tm1_test.db with entities, accounts, actuals tables')
db.close()
