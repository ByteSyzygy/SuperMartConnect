const express = require('express');
const { db } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { cloudinary, uploadSingleImage } = require("../cloudinary");

const router = express.Router();

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
  SERVICE_COUNTIES.forEach(county => {
    db.run(
      `INSERT OR IGNORE INTO counties (name, latitude, longitude) VALUES (?, ?, ?)`,
      [county.name, county.latitude, county.longitude]
    );
  });
}

// Get all counties
router.get('/counties', authenticateToken, (req, res) => {
  db.all(
    'SELECT * FROM counties WHERE is_active = 1 ORDER BY name',
    [],
    (err, rows) => {
      if (err) {
        console.error('Error fetching counties:', err);
        return res.status(500).json({ error: 'Failed to fetch counties' });
      }
      res.json(rows);
    }
  );
});

// Add new county
router.post('/counties', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { name, latitude, longitude } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'County name is required' });
  }

  db.run(
    `INSERT INTO counties (name, latitude, longitude) VALUES (?, ?, ?)`,
    [name, latitude || null, longitude || null],
    function (err) {
      if (err) {
        console.error('Error adding county:', err);
        return res.status(500).json({ error: 'Failed to add county' });
      }

      res.status(201).json({
        success: true,
        id: this.lastID,
        message: 'County added successfully'
      });
    }
  );
});

// Update county
router.put('/counties/:id', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { name, latitude, longitude, is_active } = req.body;

  db.run(
    `UPDATE counties SET name = ?, latitude = ?, longitude = ?, is_active = ? WHERE id = ?`,
    [name, latitude, longitude, is_active, req.params.id],
    function (err) {
      if (err) {
        console.error('Error updating county:', err);
        return res.status(500).json({ error: 'Failed to update county' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'County not found' });
      }

      res.json({ success: true, message: 'County updated successfully' });
    }
  );
});

// Delete county
router.delete('/counties/:id', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Soft delete - just deactivate
  db.run(
    `UPDATE counties SET is_active = 0 WHERE id = ?`,
    [req.params.id],
    function (err) {
      if (err) {
        console.error('Error deleting county:', err);
        return res.status(500).json({ error: 'Failed to delete county' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'County not found' });
      }

      res.json({ success: true, message: 'County deleted successfully' });
    }
  );
});

// Get all inventory items
router.get('/', authenticateToken, (req, res) => {
  const { branch } = req.query;

  let query = 'SELECT * FROM inventory';
  const params = [];

  if (branch && branch !== 'All') {
    query += ' WHERE branch = ?';
    params.push(branch);
  }

  query += ' ORDER BY branch, product';

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching inventory:', err);
      return res.status(500).json({ error: 'Failed to fetch inventory' });
    }

    // Format response to match original structure
    const items = rows.map(row => ({
      id: row.id,
      branch: row.branch,
      product: row.product,
      price: row.price,
      stock: row.stock,
      imageUrl: row.imageUrl
    }));

    res.json(items);
  });
});

// Get single inventory item
router.get('/:id', authenticateToken, (req, res) => {
  db.get('SELECT * FROM inventory WHERE id = ?', [req.params.id], (err, row) => {
    if (err) {
      console.error('Error fetching item:', err);
      return res.status(500).json({ error: 'Failed to fetch item' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({
      id: row.id,
      branch: row.branch,
      product: row.product,
      price: row.price,
      stock: row.stock
    });
  });
});

// Update stock (restock)
router.put('/:id/stock', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { stock } = req.body;

  if (stock === undefined || stock < 0) {
    return res.status(400).json({ error: 'Valid stock value is required' });
  }

  // Get current stock for WebSocket event
  db.get('SELECT * FROM inventory WHERE id = ?', [id], (err, oldItem) => {
    if (err || !oldItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    db.run(
      'UPDATE inventory SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [stock, id],
      function (err) {
        if (err) {
          console.error('Error updating stock:', err);
          return res.status(500).json({ error: 'Failed to update stock' });
        }

        // Format notification message
        const adminName = req.user.username;
        const increase = stock - oldItem.stock;
        const notificationMessage = `Restock Update: ${oldItem.branch} ${oldItem.product} stock increased by ${increase} unit${increase !== 1 ? 's' : ''}. New total: ${stock} (Updated by Admin ${adminName}).`;

        // Emit WebSocket event to notify all connected clients
        const io = req.app.get('io');
        io.to('admin-room').emit('stock-restocked', {
          id: parseInt(id),
          branch: oldItem.branch,
          product: oldItem.product,
          oldStock: oldItem.stock,
          newStock: stock,
          updatedBy: req.user.username,
          message: notificationMessage
        });

        io.to('customer-room').emit('inventory-updated', {
          branch: oldItem.branch,
          product: oldItem.product,
          newStock: stock
        });

        res.json({ success: true, message: 'Stock updated successfully' });
      }
    );
  });
});

// Update inventory item (price and stock)
router.put('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { price, stock } = req.body;

  if (price === undefined && stock === undefined) {
    return res.status(400).json({ error: 'At least price or stock is required' });
  }

  if (price !== undefined && (isNaN(price) || price < 0)) {
    return res.status(400).json({ error: 'Valid price is required' });
  }

  if (stock !== undefined && (isNaN(stock) || stock < 0)) {
    return res.status(400).json({ error: 'Valid stock value is required' });
  }

  // Get current item for WebSocket event
  db.get('SELECT * FROM inventory WHERE id = ?', [id], (err, oldItem) => {
    if (err || !oldItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const newPrice = price !== undefined ? price : oldItem.price;
    const newStock = stock !== undefined ? stock : oldItem.stock;

    // Format notification message
    const adminName = req.user.username;
    let notificationMessage = `Edit Update: ${oldItem.branch} ${oldItem.product} updated.`;
    if (stock !== undefined) {
      notificationMessage += ` New stock: ${newStock}.`;
    }
    if (price !== undefined) {
      notificationMessage += ` New price: KES ${newPrice}.`;
    }
    notificationMessage += ` (Updated by Admin ${adminName}).`;

    db.run(
      'UPDATE inventory SET price = ?, stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newPrice, newStock, id],
      function (err) {
        if (err) {
          console.error('Error updating item:', err);
          return res.status(500).json({ error: 'Failed to update item' });
        }

        // Emit WebSocket event to notify all connected clients
        const io = req.app.get('io');
        io.to('admin-room').emit('stock-restocked', {
          id: parseInt(id),
          branch: oldItem.branch,
          product: oldItem.product,
          oldStock: oldItem.stock,
          newStock: newStock,
          updatedBy: req.user.username,
          message: notificationMessage
        });

        io.to('customer-room').emit('inventory-updated', {
          branch: oldItem.branch,
          product: oldItem.product,
          newStock: newStock
        });

        res.json({ success: true, message: 'Item updated successfully' });
      }
    );
  });
});

// Add new inventory item (admin only)
router.post('/', authenticateToken, uploadSingleImage('image'), (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  console.log('Add product request body:', req.body);
  console.log('Add product request file:', req.file);

  const { branch, product, price, stock } = req.body;

  if (!branch || !product || price === undefined || stock === undefined) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // Ensure imageUrl is never undefined to avoid SQLITE_CONSTRAINT
  const imageUrl = req.file ? (req.file.path || req.file.url || req.file.secure_url || '') : '';
  console.log('Determined imageUrl:', imageUrl);

  // Check if item with same branch and product already exists
  db.get(
    'SELECT * FROM inventory WHERE branch = ? AND product = ?',
    [branch, product],
    (err, existingItem) => {
      if (err) {
        console.error('Error checking existing item:', err);
        return res.status(500).json({ error: 'Failed to add item' });
      }

      if (existingItem) {
        // ...Existing update logic...
        const newStock = existingItem.stock + stock;

        db.run(
          'UPDATE inventory SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [newStock, existingItem.id],
          function (err) {
            if (err) {
              console.error('Error updating stock:', err);
              return res.status(500).json({ error: 'Failed to update stock' });
            }

            const io = req.app.get('io');
            io.to('admin-room').emit('stock-restocked', {
              id: existingItem.id,
              branch: branch,
              product: product,
              oldStock: existingItem.stock,
              newStock: newStock,
              updatedBy: req.user.username,
              message: `Restock Update: ${branch} ${product} stock increased by ${stock}.`
            });

            res.status(200).json({
              success: true,
              id: existingItem.id,
              message: `Stock updated: ${product} in ${branch}`
            });
          }
        );
      } else {
        // Item doesn't exist - create new entry
        console.log('Inserting new item with values:', { branch, product, price, stock, imageUrl });
        db.run(
          'INSERT INTO inventory (branch, product, price, stock, imageUrl) VALUES (?, ?, ?, ?, ?)',
          [branch, product, price, stock, imageUrl],
          function (err) {
            if (err) {
              console.error('FULL SQL ERROR:', err);
              console.error('Values attempted:', [branch, product, price, stock, imageUrl]);
              return res.status(500).json({ error: 'Failed to add item: ' + err.message });
            }

            res.status(201).json({
              success: true,
              id: this.lastID,
              message: 'Item added successfully'
            });
          }
        );
      }
    }
  );
});

// Delete inventory item (admin only)
router.delete('/:id', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Get item info before deletion for notification
  db.get('SELECT * FROM inventory WHERE id = ?', [req.params.id], (err, item) => {
    if (err || !item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const adminName = req.user.username;
    const notificationMessage = `Delete Update: ${item.branch} ${item.product} has been removed from inventory (Deleted by Admin ${adminName}).`;

    db.run('DELETE FROM inventory WHERE id = ?', [req.params.id], function (err) {
      if (err) {
        console.error('Error deleting item:', err);
        return res.status(500).json({ error: 'Failed to delete item' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Item not found' });
      }

      // Emit WebSocket event to notify all connected admins
      const io = req.app.get('io');
      io.to('admin-room').emit('stock-restocked', {
        id: parseInt(req.params.id),
        branch: item.branch,
        product: item.product,
        deleted: true,
        updatedBy: req.user.username,
        message: notificationMessage
      });

      res.json({ success: true, message: 'Item deleted successfully' });
    });
  });
});

module.exports = router;

