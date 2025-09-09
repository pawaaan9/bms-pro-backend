const express = require('express');
const admin = require('../firebaseAdmin');

const router = express.Router();

// GET /api/users - List all users from Firestore
router.get('/', async (req, res) => {
  try {
    const usersSnapshot = await admin.firestore().collection('users').get();
    const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
