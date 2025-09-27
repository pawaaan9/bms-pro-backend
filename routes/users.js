const express = require('express');
const admin = require('../firebaseAdmin');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/users - List all users from Firestore
router.get('/', async (req, res) => {
  try {
    const usersSnapshot = await admin.firestore().collection('users').get();
    console.log('Total users found:', usersSnapshot.docs.length);
    
    const users = usersSnapshot.docs.map(doc => {
      const data = doc.data();
      console.log(`User ${doc.id} raw data:`, JSON.stringify(data, null, 2));
      
      return {
        id: doc.id,
        email: data.email,
        role: data.role,
        hallName: data.hallName || (data.owner_profile?.hallName) || null,
        contactNumber: data.contactNumber || (data.owner_profile?.contactNumber) || null,
        address: data.address ? {
          line1: data.address.line1,
          line2: data.address.line2,
          postcode: data.address.postcode,
          state: data.address.state
        } : (data.owner_profile?.address ? {
          line1: data.owner_profile.address.line1,
          line2: data.owner_profile.address.line2,
          postcode: data.owner_profile.address.postcode,
          state: data.owner_profile.address.state
        } : null)
      };
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/users - Create a new user
router.post('/', async (req, res) => {
  try {
    const { email, password, role, hallName, contactNumber, address, parentUserId, permissions, name } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate required fields
    if (!email || !password || !role) {
      return res.status(400).json({ message: 'Email, password, and role are required' });
    }

    // Validate role
    if (!['hall_owner', 'super_admin', 'sub_user'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be hall_owner, super_admin, or sub_user' });
    }

    // For sub_users, validate parent user, permissions, and name
    if (role === 'sub_user') {
      if (!parentUserId) {
        return res.status(400).json({ message: 'Parent user ID is required for sub-users' });
      }
      if (!permissions || !Array.isArray(permissions)) {
        return res.status(400).json({ message: 'Permissions array is required for sub-users' });
      }
      if (!name || !name.trim()) {
        return res.status(400).json({ message: 'Name is required for sub-users' });
      }
    }

    // For hall owners, validate required fields
    if (role === 'hall_owner') {
      if (!hallName || !contactNumber || !address || !address.line1 || !address.postcode || !address.state) {
        return res.status(400).json({ 
          message: 'Hall name, contact number, and complete address (line1, postcode, state) are required for hall owners' 
        });
      }
    }

    // Create user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      emailVerified: false
    });

    // Prepare user data for Firestore
    const userData = {
      id: userRecord.uid, // Add the UID as a field in the document
      email: email,
      role: role,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Add hall-specific data for hall owners
    if (role === 'hall_owner') {
      userData.hallName = hallName;
      userData.contactNumber = contactNumber;
      userData.address = {
        line1: address.line1,
        line2: address.line2 || '',
        postcode: address.postcode,
        state: address.state
      };
    }

    // Add sub-user specific data
    if (role === 'sub_user') {
      userData.parentUserId = parentUserId;
      userData.permissions = permissions;
      userData.status = 'active';
      userData.name = name.trim();
    }

    // Save user data to Firestore
    await admin.firestore().collection('users').doc(userRecord.uid).set(userData);

    // Log user creation
    const AuditService = require('../services/auditService');
    const hallId = req.user?.hallId || 
                   (req.user?.role === 'hall_owner' ? req.user?.uid : null) ||
                   (req.user?.role === 'sub_user' && req.user?.parentUserId ? req.user?.parentUserId : null);
    
    await AuditService.logUserCreated(
      req.user?.uid || 'system',
      req.user?.email || 'system',
      req.user?.role || 'system',
      {
        email: userRecord.email,
        role: role,
        name: name || '',
        hallName: hallName || ''
      },
      ipAddress,
      hallId
    );

    res.status(201).json({ 
      message: 'User created successfully',
      uid: userRecord.uid,
      email: userRecord.email,
      role: role
    });

  } catch (error) {
    console.error('Error creating user:', error);
    
    // Handle specific Firebase errors
    if (error.code === 'auth/email-already-exists') {
      return res.status(400).json({ message: 'Email already exists' });
    }
    if (error.code === 'auth/invalid-email') {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    if (error.code === 'auth/weak-password') {
      return res.status(400).json({ message: 'Password is too weak' });
    }

    res.status(500).json({ message: error.message });
  }
});

// PUT /api/users/settings - Update user settings (timezone, date format, currency)
router.put('/settings', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { timezone, dateFormat, timeFormat, currency } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate timezone
    const validTimezones = [
      'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
      'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid',
      'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Kolkata',
      'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth', 'Australia/Adelaide',
      'Pacific/Auckland', 'Pacific/Fiji'
    ];

    if (timezone && !validTimezones.includes(timezone)) {
      return res.status(400).json({ message: 'Invalid timezone' });
    }

    // Validate date format
    const validDateFormats = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];
    if (dateFormat && !validDateFormats.includes(dateFormat)) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    // Validate time format
    const validTimeFormats = ['12h', '24h'];
    if (timeFormat && !validTimeFormats.includes(timeFormat)) {
      return res.status(400).json({ message: 'Invalid time format' });
    }

    // Validate currency
    const validCurrencies = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'CNY', 'INR'];
    if (currency && !validCurrencies.includes(currency)) {
      return res.status(400).json({ message: 'Invalid currency' });
    }

    // Check if user exists
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get existing settings
    const existingSettings = userDoc.data().settings || {};
    
    // Prepare new settings object
    const newSettings = { ...existingSettings };
    
    // Add settings fields if provided
    if (timezone !== undefined) {
      newSettings.timezone = timezone;
    }
    if (dateFormat !== undefined) {
      newSettings.dateFormat = dateFormat;
    }
    if (timeFormat !== undefined) {
      newSettings.timeFormat = timeFormat;
    }
    if (currency !== undefined) {
      newSettings.currency = currency;
    }

    // Prepare settings update
    const settingsUpdate = {
      settings: newSettings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Update user settings in Firestore
    await admin.firestore().collection('users').doc(userId).update(settingsUpdate);

    // Log settings update
    const AuditService = require('../services/auditService');
    const hallId = req.user?.hallId || 
                   (req.user?.role === 'hall_owner' ? req.user?.uid : null) ||
                   (req.user?.role === 'sub_user' && req.user?.parentUserId ? req.user?.parentUserId : null);
    
    await AuditService.logSettingsUpdated(
      req.user?.uid || 'system',
      req.user?.email || 'system',
      req.user?.role || 'system',
      {
        timezone: timezone || null,
        dateFormat: dateFormat || null,
        timeFormat: timeFormat || null,
        currency: currency || null
      },
      ipAddress,
      hallId
    );

    res.json({ 
      message: 'Settings updated successfully',
      settings: newSettings
    });

  } catch (error) {
    console.error('Error updating user settings:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/settings - Get user settings
router.get('/settings', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    // Get user data from Firestore
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    const settings = userData.settings || {};

    // Return default settings if none exist
    const defaultSettings = {
      timezone: 'Australia/Sydney',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '12h',
      currency: 'AUD'
    };

    res.json({
      ...defaultSettings,
      ...settings
    });

  } catch (error) {
    console.error('Error fetching user settings:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/users/:id - Update a user
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, role, hallName, contactNumber, address } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate required fields
    if (!email || !role) {
      return res.status(400).json({ message: 'Email and role are required' });
    }

    // Validate role
    if (!['hall_owner', 'super_admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be hall_owner or super_admin' });
    }

    // For hall owners, validate required fields
    if (role === 'hall_owner') {
      if (!hallName || !contactNumber || !address || !address.line1 || !address.postcode || !address.state) {
        return res.status(400).json({ 
          message: 'Hall name, contact number, and complete address (line1, postcode, state) are required for hall owners' 
        });
      }
    }

    // Check if user exists
    const userDoc = await admin.firestore().collection('users').doc(id).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const oldUserData = userDoc.data();

    // Prepare user data for Firestore
    const userData = {
      id: id, // Ensure the ID field is maintained
      email: email,
      role: role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Add hall-specific data for hall owners
    if (role === 'hall_owner') {
      userData.hallName = hallName;
      userData.contactNumber = contactNumber;
      userData.address = {
        line1: address.line1,
        line2: address.line2 || '',
        postcode: address.postcode,
        state: address.state
      };
    } else {
      // Remove hall-specific data for non-hall owners
      userData.hallName = admin.firestore.FieldValue.delete();
      userData.contactNumber = admin.firestore.FieldValue.delete();
      userData.address = admin.firestore.FieldValue.delete();
    }

    // Update user data in Firestore
    await admin.firestore().collection('users').doc(id).update(userData);

    // Update email in Firebase Auth if it changed
    const currentUser = await admin.auth().getUser(id);
    if (currentUser.email !== email) {
      await admin.auth().updateUser(id, { email: email });
    }

    // Log user update
    const AuditService = require('../services/auditService');
    const hallId = req.user?.hallId || 
                   (req.user?.role === 'hall_owner' ? req.user?.uid : null) ||
                   (req.user?.role === 'sub_user' && req.user?.parentUserId ? req.user?.parentUserId : null);
    
    await AuditService.logUserUpdated(
      req.user?.uid || 'system',
      req.user?.email || 'system',
      req.user?.role || 'system',
      oldUserData,
      {
        ...oldUserData,
        email: email,
        role: role,
        hallName: hallName || oldUserData.hallName,
        contactNumber: contactNumber || oldUserData.contactNumber,
        address: address || oldUserData.address
      },
      ipAddress,
      hallId
    );

    res.json({ 
      message: 'User updated successfully',
      uid: id,
      email: email,
      role: role
    });

  } catch (error) {
    console.error('Error updating user:', error);
    
    // Handle specific Firebase errors
    if (error.code === 'auth/email-already-exists') {
      return res.status(400).json({ message: 'Email already exists' });
    }
    if (error.code === 'auth/invalid-email') {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/users/:id - Delete a user
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Check if user exists
    const userDoc = await admin.firestore().collection('users').doc(id).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();

    // Delete user from Firebase Auth
    await admin.auth().deleteUser(id);

    // Delete user data from Firestore
    await admin.firestore().collection('users').doc(id).delete();

    // Log user deletion
    const AuditService = require('../services/auditService');
    const hallId = req.user?.hallId || 
                   (req.user?.role === 'hall_owner' ? req.user?.uid : null) ||
                   (req.user?.role === 'sub_user' && req.user?.parentUserId ? req.user?.parentUserId : null);
    
    await AuditService.logUserDeleted(
      req.user?.uid || 'system',
      req.user?.email || 'system',
      req.user?.role || 'system',
      userData,
      ipAddress,
      hallId
    );

    res.json({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/profile - Get current user's profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log('Fetching profile for user ID:', userId);
    
    // Get user data from Firestore
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      console.log('User document not found for ID:', userId);
      return res.status(404).json({ message: 'User profile not found' });
    }

    const userData = userDoc.data();
    console.log('Raw user data from Firestore:', JSON.stringify(userData, null, 2));
    
    // Return user profile data
    const profile = {
      id: userId,
      email: userData.email,
      role: userData.role,
      hallName: userData.hallName || (userData.owner_profile?.hallName) || null,
      contactNumber: userData.contactNumber || (userData.owner_profile?.contactNumber) || null,
      address: userData.address || (userData.owner_profile?.address) || null,
      createdAt: userData.createdAt,
      updatedAt: userData.updatedAt
    };

    // Add sub-user specific data
    if (userData.role === 'sub_user') {
      profile.parentUserId = userData.parentUserId;
      profile.permissions = userData.permissions || [];
      profile.status = userData.status || 'active';
      profile.name = userData.name || '';
    }

    console.log('Processed profile data:', JSON.stringify(profile, null, 2));
    res.json(profile);

  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/users/customers - Create a new customer (public endpoint for customer registration)
router.post('/customers', async (req, res) => {
  try {
    const {
      customerId,
      name,
      email,
      phone,
      avatar,
      source
    } = req.body;

    // Validate required fields
    if (!customerId || !name || !email) {
      return res.status(400).json({
        message: 'Missing required fields: customerId, name, email'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Check if customer already exists
    const existingCustomer = await admin.firestore().collection('customers').doc(customerId).get();
    if (existingCustomer.exists) {
      return res.status(409).json({ message: 'Customer already exists with this ID' });
    }

    // Create customer data
    const customerData = {
      customerId: customerId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : '',
      avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=e63946&color=fff`,
      role: 'customer',
      status: 'active',
      source: source || 'website',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Save to customers collection in Firestore
    await admin.firestore().collection('customers').doc(customerId).set(customerData);

    console.log('Customer created successfully:', {
      customerId: customerId,
      name: name,
      email: email,
      source: source || 'website'
    });

    res.status(201).json({
      message: 'Customer created successfully',
      customer: {
        id: customerId,
        ...customerData,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/sub-users/:parentUserId - Get all sub-users for a hall owner
router.get('/sub-users/:parentUserId', async (req, res) => {
  try {
    const { parentUserId } = req.params;
    
    const subUsersSnapshot = await admin.firestore()
      .collection('users')
      .where('parentUserId', '==', parentUserId)
      .where('role', '==', 'sub_user')
      .get();
    
    const subUsers = subUsersSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        email: data.email,
        name: data.name || '',
        role: data.role,
        permissions: data.permissions || [],
        status: data.status || 'active',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      };
    });
    
    res.json(subUsers);
  } catch (error) {
    console.error('Error fetching sub-users:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/users/sub-users/:id - Update sub-user permissions
router.put('/sub-users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions, status, name } = req.body;

    // Check if user exists and is a sub-user
    const userDoc = await admin.firestore().collection('users').doc(id).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    if (userData.role !== 'sub_user') {
      return res.status(400).json({ message: 'User is not a sub-user' });
    }

    // Prepare update data
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (permissions !== undefined) {
      updateData.permissions = permissions;
    }

    if (status !== undefined) {
      updateData.status = status;
    }

    if (name !== undefined && name.trim()) {
      updateData.name = name.trim();
    }

    // Update user data in Firestore
    await admin.firestore().collection('users').doc(id).update(updateData);

    res.json({ 
      message: 'Sub-user updated successfully',
      uid: id
    });

  } catch (error) {
    console.error('Error updating sub-user:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/permissions - Get available permissions
router.get('/permissions', async (req, res) => {
  try {
    const permissions = [
      { id: 'dashboard', name: 'Dashboard', description: 'Access to dashboard overview' },
      { id: 'calendar', name: 'Calendar', description: 'View and manage calendar' },
      { id: 'bookings', name: 'Bookings', description: 'Manage all bookings' },
      { id: 'invoices', name: 'Invoices & Payments', description: 'Manage invoices and payments' },
      { id: 'resources', name: 'Resources', description: 'Manage hall resources' },
      { id: 'pricing', name: 'Pricing', description: 'Manage pricing and rate cards' },
      { id: 'customers', name: 'Customers', description: 'Manage customer information' },
      { id: 'reports', name: 'Reports', description: 'View and generate reports' },
      { id: 'comms', name: 'Comms', description: 'Manage communications' },
      { id: 'settings', name: 'Settings', description: 'Access system settings' },
      { id: 'audit', name: 'Audit Log', description: 'View audit logs' },
      { id: 'help', name: 'Help', description: 'Access help documentation' }
    ];

    res.json(permissions);
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/parent-data/:parentUserId - Get parent user's data for sub-users
router.get('/parent-data/:parentUserId', async (req, res) => {
  try {
    const { parentUserId } = req.params;
    
    // Get parent user data
    const parentUserDoc = await admin.firestore().collection('users').doc(parentUserId).get();
    
    if (!parentUserDoc.exists) {
      return res.status(404).json({ message: 'Parent user not found' });
    }

    const parentData = parentUserDoc.data();
    
    // Return parent user's hall information
    const parentInfo = {
      id: parentUserId,
      email: parentData.email,
      role: parentData.role,
      hallName: parentData.hallName || (parentData.owner_profile?.hallName) || null,
      contactNumber: parentData.contactNumber || (parentData.owner_profile?.contactNumber) || null,
      address: parentData.address || (parentData.owner_profile?.address) || null
    };

    res.json(parentInfo);
  } catch (error) {
    console.error('Error fetching parent user data:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
