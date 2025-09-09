const express = require('express');
const admin = require('../firebaseAdmin');

const router = express.Router();

// GET /api/users - List all users from Firestore
router.get('/', async (req, res) => {
  try {
    const usersSnapshot = await admin.firestore().collection('users').get();
    const users = usersSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        email: data.email,
        role: data.role,
        hallName: data.hallName,
        address: data.address ? {
          line1: data.address.line1,
          line2: data.address.line2,
          postcode: data.address.postcode,
          state: data.address.state
        } : null
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
    const { email, password, role, hallName, address } = req.body;

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
      if (!hallName || !address || !address.line1 || !address.postcode || !address.state) {
        return res.status(400).json({ 
          message: 'Hall name and complete address (line1, postcode, state) are required for hall owners' 
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

module.exports = router;
