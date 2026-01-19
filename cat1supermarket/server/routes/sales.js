const express = require('express');
const { db } = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Record a sale
router.post('/', authenticateToken, (req, res) => {
  const { branch, product, quantity, total_amount } = req.body;

  if (!branch || !product || !quantity || total_amount === undefined) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (quantity <= 0 || total_amount < 0) {
    return res.status(400).json({ error: 'Invalid quantity or amount' });
  }

  db.run(
    `INSERT INTO sales (user_id, branch, product, quantity, total_amount, timestamp) 
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [req.user.id, branch, product, quantity, total_amount],
    function (err) {
      if (err) {
        console.error('Error recording sale:', err);
        return res.status(500).json({ error: 'Failed to record sale' });
      }

      // Get updated stock for the item
      db.get(
        'SELECT stock FROM inventory WHERE branch = ? AND product = ?',
        [branch, product],
        (err, stockRow) => {
          const currentStock = stockRow ? stockRow.stock : 0;
          const newStock = Math.max(0, currentStock - quantity);

          // Update inventory stock
          db.run(
            'UPDATE inventory SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE branch = ? AND product = ?',
            [newStock, branch, product],
            (err) => {
              if (err) console.error('Error updating stock:', err);
            }
          );

          // Emit WebSocket event to notify all connected clients
          const io = req.app.get('io');
          io.to('admin-room').emit('inventory-updated', {
            branch,
            product,
            oldStock: currentStock,
            newStock,
            saleId: this.lastID
          });

          io.to('customer-room').emit('inventory-updated', {
            branch,
            product,
            newStock
          });
        }
      );

      res.status(201).json({
        success: true,
        id: this.lastID,
        message: 'Sale recorded successfully'
      });
    }
  );
});

// Get sales report
router.get('/report', authenticateToken, (req, res) => {
  const { startDate, endDate, branch } = req.query;

  let query = `SELECT * FROM sales WHERE 1=1`;
  const params = [];

  if (startDate) {
    query += ' AND timestamp >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND timestamp <= ?';
    params.push(endDate);
  }

  if (branch && branch !== 'All') {
    query += ' AND branch = ?';
    params.push(branch);
  }

  query += ' ORDER BY timestamp DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching sales:', err);
      return res.status(500).json({ error: 'Failed to fetch sales report' });
    }

    res.json(rows);
  });
});

// Get sales summary statistics
router.get('/summary', authenticateToken, (req, res) => {
  const { branch } = req.query;

  let query = `
    SELECT 
      SUM(quantity) as total_items_sold,
      SUM(total_amount) as total_revenue,
      COUNT(*) as total_transactions
    FROM sales
  `;
  const params = [];

  if (branch && branch !== 'All') {
    query += ' WHERE branch = ?';
    params.push(branch);
  }

  db.get(query, params, (err, row) => {
    if (err) {
      console.error('Error fetching summary:', err);
      return res.status(500).json({ error: 'Failed to fetch summary' });
    }

    res.json({
      total_items_sold: row.total_items_sold || 0,
      total_revenue: row.total_revenue || 0,
      total_transactions: row.total_transactions || 0
    });
  });
});

// Get sales by product
router.get('/by-product', authenticateToken, (req, res) => {
  const { branch } = req.query;

  let query = `
    SELECT 
      product,
      SUM(quantity) as total_quantity,
      SUM(total_amount) as total_revenue
    FROM sales
  `;
  const params = [];

  if (branch && branch !== 'All') {
    query += ' WHERE branch = ?';
    params.push(branch);
  }

  query += ' GROUP BY product ORDER BY total_quantity DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching sales by product:', err);
      return res.status(500).json({ error: 'Failed to fetch data' });
    }

    res.json(rows);
  });
});

// Get sales by branch
router.get('/by-branch', authenticateToken, (req, res) => {
  let query = `
    SELECT 
      branch,
      COUNT(*) as total_sales,
      SUM(quantity) as total_items,
      SUM(total_amount) as total_revenue
    FROM sales
    GROUP BY branch
    ORDER BY total_revenue DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Error fetching sales by branch:', err);
      return res.status(500).json({ error: 'Failed to fetch data' });
    }

    res.json(rows);
  });
});

// Get current user's sales history
router.get('/my-purchases', authenticateToken, (req, res) => {
  db.all(
    'SELECT * FROM sales WHERE user_id = ? ORDER BY timestamp DESC',
    [req.user.id],
    (err, rows) => {
      if (err) {
        console.error('Error fetching user sales:', err);
        return res.status(500).json({ error: 'Failed to fetch purchase history' });
      }
      res.json(rows);
    }
  );
});

module.exports = router;

