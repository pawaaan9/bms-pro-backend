const express = require('express');
const admin = require('../firebaseAdmin');

const router = express.Router();

// Middleware to verify token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('Authorization header:', authHeader);
    
    const token = authHeader?.split(' ')[1];
    if (!token) {
      console.log('No token provided');
      return res.status(401).json({ message: 'No token provided' });
    }

    console.log('Token received:', token.substring(0, 20) + '...');
    
    // Try to verify as JWT first, then Firebase token
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      console.log('JWT decoded:', decoded);
      req.user = decoded;
      next();
    } catch (jwtError) {
      console.log('JWT verification failed, trying Firebase token:', jwtError.message);
      const decodedToken = await admin.auth().verifyIdToken(token);
      console.log('Firebase token decoded:', decodedToken);
      req.user = decodedToken;
      next();
    }
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
};

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
    const { email, password, role, hallName, contactNumber, address } = req.body;

    // Validate required fields
    if (!email || !password || !role) {
      return res.status(400).json({ message: 'Email, password, and role are required' });
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

    // Create user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      emailVerified: false
    });

    // Prepare user data for Firestore
    const userData = {
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

    // Save user data to Firestore
    await admin.firestore().collection('users').doc(userRecord.uid).set(userData);

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

// PUT /api/users/:id - Update a user
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, role, hallName, contactNumber, address } = req.body;

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

    // Prepare user data for Firestore
    const userData = {
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

    // Check if user exists
    const userDoc = await admin.firestore().collection('users').doc(id).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Delete user from Firebase Auth
    await admin.auth().deleteUser(id);

    // Delete user data from Firestore
    await admin.firestore().collection('users').doc(id).delete();

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

    console.log('Processed profile data:', JSON.stringify(profile, null, 2));
    res.json(profile);

  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
