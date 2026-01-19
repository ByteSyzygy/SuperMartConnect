const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'supermarket.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database:', DB_PATH);
  }
});

// Initialize tables
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'customer',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Inventory table
      db.run(`
        CREATE TABLE IF NOT EXISTS inventory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          branch TEXT NOT NULL,
          product TEXT NOT NULL,
          price REAL NOT NULL,
          stock INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Sales table
      db.run(`
        CREATE TABLE IF NOT EXISTS sales (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          branch TEXT NOT NULL,
          product TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          total_amount REAL NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // M-Pesa transactions table
      db.run(`
        CREATE TABLE IF NOT EXISTS mpesa_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          merchant_request_id TEXT UNIQUE NOT NULL,
          checkout_request_id TEXT UNIQUE NOT NULL,
          phone TEXT NOT NULL,
          amount REAL NOT NULL,
          branch TEXT,
          product TEXT,
          status TEXT DEFAULT 'pending',
          result_code INTEGER,
          result_desc TEXT,
          mpesa_receipt TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME
        )
      `);

      // Counties table for dynamic county management
      db.run(`
        CREATE TABLE IF NOT EXISTS counties (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          latitude REAL,
          longitude REAL,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Seed initial data
      seedData();
      
      // Initialize counties
      initializeCounties();
      
      console.log('Database tables initialized');
      resolve();
    });
  });
}

// Default counties with coordinates (Kenya)
const DEFAULT_COUNTIES = [
  { name: 'Nairobi', latitude: -1.2921, longitude: 36.8219 },
  { name: 'Kisumu', latitude: -0.1022, longitude: 34.7617 },
  { name: 'Mombasa', latitude: -4.0435, longitude: 39.6682 },
  { name: 'Nakuru', latitude: -0.3031, longitude: 36.0800 },
  { name: 'Eldoret', latitude: 0.5143, longitude: 35.2698 }
];

// Initialize counties table
function initializeCounties() {
  DEFAULT_COUNTIES.forEach(county => {
    db.run(
      `INSERT OR IGNORE INTO counties (name, latitude, longitude) VALUES (?, ?, ?)`,
      [county.name, county.latitude, county.longitude]
    );
  });
}

function seedData() {
  // Check if data already exists
  db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
    if (row.count > 0) {
      console.log('Data already seeded, skipping...');
      return;
    }

    const bcrypt = require('bcryptjs');
    const defaultPassword = '123';

    // Hash password
    bcrypt.hash(defaultPassword, 10, (err, hash) => {
      // Insert users
      db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
        ['admin', hash, 'admin']);
      db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
        ['user', hash, 'customer']);

      // Insert inventory
      const inventoryData = [
        ['Kisumu', 'Coke', 100, 50],
        ['Kisumu', 'Fanta', 100, 30],
        ['Mombasa', 'Sprite', 100, 45],
        ['Nairobi', 'Coke', 120, 100],
        ['Nakuru', 'Coke', 110, 75],
        ['Nakuru', 'Fanta', 110, 40],
        ['Nakuru', 'Sprite', 110, 35],
        ['Eldoret', 'Coke', 105, 60],
        ['Eldoret', 'Sprite', 105, 55],
        ['Mombasa', 'Coke', 115, 80],
        ['Mombasa', 'Fanta', 115, 45],
        ['Kisumu', 'Sprite', 100, 25]
      ];

      inventoryData.forEach(([branch, product, price, stock]) => {
        db.run(`INSERT INTO inventory (branch, product, price, stock) VALUES (?, ?, ?, ?)`,
          [branch, product, price, stock]);
      });

      console.log('Initial data seeded successfully');
    });
  });
}

module.exports = { db, initializeDatabase, initializeCounties };

