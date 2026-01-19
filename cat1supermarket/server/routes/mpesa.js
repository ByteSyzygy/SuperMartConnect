const express = require('express');
const axios = require('axios');
const { db } = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Validate required environment variables on startup
function validateEnvVariables() {
  const required = [
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET', 
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CALLBACK_URL'
  ];
  
  const missing = [];
  const envWarnings = [];
  
  // Build config status object for API responses
  const configStatus = {
    valid: true,
    missing: [],
    warnings: [],
    shortcode: null,
    hasValidCredentials: false
  };
  
  required.forEach(envVar => {
    if (!process.env[envVar]) {
      missing.push(envVar);
      configStatus.missing.push(envVar);
    }
  });
  
  // Check for example/default values that should be replaced
  if (!process.env.MPESA_CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY === 'your_consumer_key_here') {
    envWarnings.push('MPESA_CONSUMER_KEY is still set to default placeholder value');
  }
  if (!process.env.MPESA_PASSKEY || process.env.MPESA_PASSKEY === 'your_passkey_here') {
    envWarnings.push('MPESA_PASSKEY is still set to default placeholder value');
  }
  
  configStatus.warnings = envWarnings;
  configStatus.shortcode = process.env.MPESA_SHORTCODE || null;
  configStatus.hasValidCredentials = missing.length === 0 && envWarnings.length === 0;
  
  if (missing.length > 0) {
    configStatus.valid = false;
    console.error('\n❌ M-Pesa Configuration Error:');
    console.error('   Missing required environment variables:');
    missing.forEach(v => console.error(`   - ${v}`));
    console.error('\n   Please copy .env.example to .env and fill in your credentials.');
    console.error('   See MPESA_SETUP.md for detailed instructions.\n');
  }
  
  if (envWarnings.length > 0) {
    console.warn('\n⚠️  M-Pesa Configuration Warnings:');
    envWarnings.forEach(v => console.warn(`   - ${v}`));
    console.warn('   These should be replaced with actual Daraja API credentials.\n');
    configStatus.valid = false;
  }
  
  if (configStatus.valid) {
    console.log('\n✅ M-Pesa configuration validated successfully');
    console.log(`   Shortcode: ${process.env.MPESA_SHORTCODE}`);
    console.log(`   Callback URL: ${process.env.MPESA_CALLBACK_URL}\n`);
  }
  
  return configStatus;
}

// Validate immediately on module load and export config status
const mpesaConfig = validateEnvVariables();

// M-Pesa Daraja API configuration
const MPESA_CONFIG = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  shortcode: process.env.MPESA_SHORTCODE,
  passkey: process.env.MPESA_PASSKEY,
  callbackUrl: process.env.MPESA_CALLBACK_URL,
  // Daraja API endpoints
  authUrl: 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
  stkPushUrl: 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
  stkQueryUrl: 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query'
};

// Cache for access token
let accessToken = null;
let tokenExpiry = null;

// Helper function to get M-Pesa access token
async function getAccessToken() {
  try {
    // Check if we have a valid cached token
    if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
      return accessToken;
    }

    // Validate that we have credentials
    if (!MPESA_CONFIG.consumerKey || !MPESA_CONFIG.consumerSecret) {
      throw new Error('M-Pesa credentials not configured');
    }

    const auth = Buffer.from(`${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`).toString('base64');

    console.log('Requesting M-Pesa access token...');
    const response = await axios.get(MPESA_CONFIG.authUrl, {
      headers: {
        'Authorization': `Basic ${auth}`
      },
      timeout: 30000 // 30 second timeout
    });

    accessToken = response.data.access_token;
    // Set expiry to 50 minutes (tokens are valid for 1 hour)
    tokenExpiry = Date.now() + (50 * 60 * 1000);

    console.log('M-Pesa access token obtained successfully');
    return accessToken;
  } catch (error) {
    console.error('Error getting M-Pesa access token:');
    console.error('  Response:', error.response?.data || error.message);
    console.error('  Status:', error.response?.status || 'N/A');
    
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Cannot connect to M-Pesa API. Please check your internet connection.');
    } else if (error.response?.status === 401) {
      throw new Error('Invalid M-Pesa credentials. Please check your Consumer Key and Secret.');
    }
    throw new Error('Failed to get M-Pesa access token: ' + (error.response?.data?.errorDescription || error.message));
  }
}

// Helper function to generate M-Pesa password
function generateMpesaPassword() {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const password = Buffer.from(`${MPESA_CONFIG.shortcode}${MPESA_CONFIG.passkey}${timestamp}`).toString('base64');
  return { password, timestamp };
}

// Get M-Pesa configuration status (for debugging and frontend)
router.get('/config-status', authenticateToken, (req, res) => {
  res.json({
    configured: mpesaConfig.valid,
    hasCredentials: mpesaConfig.hasValidCredentials,
    missingVariables: mpesaConfig.missing,
    warnings: mpesaConfig.warnings,
    shortcode: mpesaConfig.shortcode,
    setupInstructions: 'See MPESA_SETUP.md for detailed instructions'
  });
});

// Test M-Pesa API connectivity
router.get('/test-connection', authenticateToken, async (req, res) => {
  try {
    // Check if credentials are configured
    if (!mpesaConfig.hasValidCredentials) {
      return res.status(500).json({
        success: false,
        message: 'M-Pesa credentials not configured',
        missingVariables: mpesaConfig.missing,
        warnings: mpesaConfig.warnings
      });
    }

    // Try to get access token
    const token = await getAccessToken();
    
    res.json({
      success: true,
      message: 'M-Pesa API connection successful',
      tokenReceived: true,
      expiresIn: tokenExpiry ? Math.round((tokenExpiry - Date.now()) / 1000) : 0
    });
  } catch (error) {
    console.error('M-Pesa connection test failed:', error.message);
    res.status(500).json({
      success: false,
      message: error.message,
      hint: 'Check your .env configuration and internet connection'
    });
  }
});

// STK Push endpoint
router.post('/stkpush', authenticateToken, async (req, res) => {
  // Check if configuration is valid
  if (!mpesaConfig.valid) {
    return res.status(500).json({ 
      error: 'M-Pesa configuration is incomplete',
      message: 'Please configure your M-Pesa credentials in the .env file',
      missingVariables: mpesaConfig.missing,
      warnings: mpesaConfig.warnings,
      setupGuide: 'See MPESA_SETUP.md for detailed instructions'
    });
  }

  const { phone, amount, branch, product } = req.body;

  if (!phone || !amount) {
    return res.status(400).json({ error: 'Phone and amount are required' });
  }

  // Format phone number to 254XXXXXXXXX format
  let formattedPhone = phone.replace(/[^0-9]/g, '');
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '254' + formattedPhone.substring(1);
  } else if (!formattedPhone.startsWith('254')) {
    formattedPhone = '254' + formattedPhone;
  }

  // Validate phone format
  if (!/^254[0-9]{9}$/.test(formattedPhone)) {
    return res.status(400).json({ 
      error: 'Invalid phone number format',
      message: 'Phone must be in format 254XXXXXXXXX (12 digits starting with 254)'
    });
  }

  try {
    const { password, timestamp } = generateMpesaPassword();
    const token = await getAccessToken();

    // Prepare STK Push request payload
    const stkPushPayload = {
      BusinessShortCode: MPESA_CONFIG.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount), // Must be integer
      PartyA: formattedPhone,
      PartyB: MPESA_CONFIG.shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: MPESA_CONFIG.callbackUrl,
      AccountReference: `Supermarket-${branch || 'Main'}`,
      TransactionDesc: `Purchase ${product || 'Items'} at ${branch || 'Main'}`
    };

    console.log('Initiating STK Push...', {
      phone: formattedPhone,
      amount: Math.round(amount),
      timestamp,
      shortcode: MPESA_CONFIG.shortcode
    });

    // Make actual call to M-Pesa Daraja STK Push API
    const response = await axios.post(MPESA_CONFIG.stkPushUrl, stkPushPayload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });

    const stkResponse = response.data;

    console.log('STK Push response:', stkResponse);

    // Store pending transaction for callback verification
    db.run(
      `INSERT INTO mpesa_transactions 
       (merchant_request_id, checkout_request_id, phone, amount, branch, product, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [stkResponse.MerchantRequestID, stkResponse.CheckoutRequestID, formattedPhone, amount, branch, product],
      function(err) {
        if (err) {
          console.error('Error storing transaction:', err);
        }
      }
    );

    // Emit WebSocket event for real-time payment status
    const io = req.app.get('io');
    io.to('admin-room').emit('mpesa-initiated', {
      phone: formattedPhone,
      amount,
      branch,
      product,
      merchantRequestId: stkResponse.MerchantRequestID
    });

    res.json({
      success: true,
      message: 'STK Push initiated successfully. Please check your phone.',
      data: {
        merchantRequestID: stkResponse.MerchantRequestID,
        checkoutRequestID: stkResponse.CheckoutRequestID,
        responseCode: stkResponse.ResponseCode,
        responseDescription: stkResponse.ResponseDescription,
        customerMessage: stkResponse.CustomerMessage
      }
    });
  } catch (error) {
    console.error('STK Push error:', error.response?.data || error.message);
    
    // Provide more helpful error messages
    const errorData = error.response?.data;
    let errorMessage = 'Failed to initiate STK Push';
    let errorCode = 'UNKNOWN_ERROR';
    
    if (errorData?.errorMessage) {
      errorMessage = errorData.errorMessage;
    } else if (errorData?.errorCode) {
      errorCode = errorData.errorCode;
    }
    
    if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Cannot connect to M-Pesa API. Please check your internet connection.';
      errorCode = 'CONNECTION_ERROR';
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      errorMessage = 'M-Pesa API request timed out. Please try again.';
      errorCode = 'TIMEOUT';
    } else if (error.response?.status === 500) {
      errorMessage = 'M-Pesa API returned an internal error. Please try again later.';
      errorCode = 'MPESA_SERVER_ERROR';
    } else if (error.response?.status === 401) {
      errorMessage = 'Invalid M-Pesa credentials. Please check your configuration.';
      errorCode = 'AUTH_ERROR';
    }

    res.status(500).json({ 
      error: errorMessage,
      errorCode: errorCode,
      details: errorData || error.message,
      hint: 'See MPESA_SETUP.md for troubleshooting guide'
    });
  }
});

// STK Push Status Query
router.post('/stkquery', authenticateToken, async (req, res) => {
  // Check if configuration is valid
  if (!mpesaConfig.valid) {
    return res.status(500).json({ 
      error: 'M-Pesa configuration is incomplete',
      message: 'Please configure your M-Pesa credentials in the .env file'
    });
  }

  const { checkoutRequestID, merchantRequestID } = req.body;

  if (!checkoutRequestID) {
    return res.status(400).json({ error: 'CheckoutRequestID is required' });
  }

  try {
    const { password, timestamp } = generateMpesaPassword();
    const token = await getAccessToken();

    const queryPayload = {
      BusinessShortCode: MPESA_CONFIG.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestID
    };

    const response = await axios.post(MPESA_CONFIG.stkQueryUrl, queryPayload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const queryResponse = response.data;

    // Update local transaction status
    if (merchantRequestID) {
      db.run(
        `UPDATE mpesa_transactions 
         SET status = ?, result_code = ?, result_desc = ?, completed_at = CURRENT_TIMESTAMP 
         WHERE merchant_request_id = ?`,
        [
          queryResponse.ResultCode === 0 ? 'completed' : 'failed',
          queryResponse.ResultCode,
          queryResponse.ResultDesc,
          merchantRequestID
        ],
        function(err) {
          if (err) {
            console.error('Error updating transaction:', err);
          }
        }
      );
    }

    res.json({
      success: true,
      data: {
        checkoutRequestID: queryResponse.CheckoutRequestID,
        resultCode: queryResponse.ResultCode,
        resultDesc: queryResponse.ResultDesc,
        status: queryResponse.ResultCode === 0 ? 'success' : 'failed'
      }
    });
  } catch (error) {
    console.error('STK Query error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to query transaction status',
      details: error.response?.data || error.message
    });
  }
});

// M-Pesa Callback endpoint
router.post('/callback', async (req, res) => {
  const { Body } = req.body;
  console.log("the callback response is ", Body)

  try {
    if (Body && Body.stkCallback) {
      const callback = Body.stkCallback;
      const merchantRequestID = callback.MerchantRequestID;
      const checkoutRequestID = callback.CheckoutRequestID;
      const resultCode = callback.ResultCode;
      const resultDesc = callback.ResultDesc;
      
      // Extract metadata if available
      console.log("the call back is", callback)
      const metaData = callback.CallbackMetadata?.Item || [];
      console.log("the metaData is ", metaData);
      const amount = metaData.find(item => item.Name === 'Amount')?.Value;
      const mpesaReceiptNumber = metaData.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
      const transactionDate = metaData.find(item => item.Name === 'TransactionDate')?.Value;
      const phoneNumber = metaData.find(item => item.Name === 'PhoneNumber')?.Value;

      console.log('M-Pesa Callback received:', {
        merchantRequestID,
        checkoutRequestID,
        resultCode,
        resultDesc,
        amount,
        mpesaReceiptNumber
      });

      // Update transaction status
      db.run(
        `UPDATE mpesa_transactions 
         SET status = ?, result_code = ?, result_desc = ?, mpesa_receipt = ?, completed_at = CURRENT_TIMESTAMP 
         WHERE merchant_request_id = ?`,
        [resultCode === 0 ? 'completed' : 'failed', resultCode, resultDesc, mpesaReceiptNumber, merchantRequestID],
        function(err) {
          if (err) {
            console.error('Error updating transaction:', err);
          }
        }
      );

      // Emit WebSocket event for real-time payment confirmation
      const io = req.app.get('io');
      io.to('admin-room').emit('mpesa-callback', {
        merchantRequestID,
        checkoutRequestID,
        status: resultCode === 0 ? 'success' : 'failed',
        resultDesc,
        amount,
        mpesaReceiptNumber
      });

      // If payment successful, emit sale event
      if (resultCode === 0) {
        db.get(
          'SELECT * FROM mpesa_transactions WHERE merchant_request_id = ?',
          [merchantRequestID],
          (err, transaction) => {
            if (transaction) {
              io.to('admin-room').emit('sale-completed', {
                branch: transaction.branch,
                product: transaction.product,
                quantity: 1, // Default quantity for callback
                total_amount: transaction.amount,
                paymentMethod: 'mpesa',
                mpesaReceipt: mpesaReceiptNumber
              });
            }
          }
        );
      }
    }

    // Always respond with success to M-Pesa
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (error) {
    console.error('Callback error:', error);
    // Still return success to M-Pesa to prevent retries
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  }
});

// Get transaction history
router.get('/transactions', authenticateToken, (req, res) => {
  db.all(
    `SELECT * FROM mpesa_transactions ORDER BY created_at DESC LIMIT 50`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch transactions' });
      }

      res.json(rows.map(row => ({
        id: row.id,
        phone: row.phone.substring(0, 6) + '****' + row.phone.substring(row.phone.length - 2),
        amount: row.amount,
        branch: row.branch,
        product: row.product,
        status: row.status,
        mpesaReceipt: row.mpesa_receipt,
        createdAt: row.created_at,
        completedAt: row.completed_at
      })));
    }
  );
});

// Get access token status (for debugging)
router.get('/token-status', authenticateToken, (req, res) => {
  res.json({
    hasToken: !!accessToken,
    expiresIn: tokenExpiry ? Math.round((tokenExpiry - Date.now()) / 1000) : 0,
    isExpired: tokenExpiry ? Date.now() >= tokenExpiry : true
  });
});

module.exports = router;

