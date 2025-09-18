const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const admin = require('./firebaseAdmin');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());


// Auth routes
const authRoutes = require('./routes/auth');
app.use('/api', authRoutes);

// Users routes
const usersRoutes = require('./routes/users');
app.use('/api/users', usersRoutes);

// Resources routes
const resourcesRoutes = require('./routes/resources');
app.use('/api/resources', resourcesRoutes);

// Pricing routes
const pricingRoutes = require('./routes/pricing');
app.use('/api/pricing', pricingRoutes);

// Bookings routes
const bookingsRoutes = require('./routes/bookings');
app.use('/api/bookings', bookingsRoutes);

// Notifications routes
const notificationsRoutes = require('./routes/notifications');
app.use('/api/notifications', notificationsRoutes);

// Dashboard routes
const dashboardRoutes = require('./routes/dashboard');
app.use('/api/dashboard', dashboardRoutes);

// Login endpoint (returns JWT token)
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Missing fields' });
  }
  try {
    // For now, we'll skip password verification and just check if user exists
    // In production, you should use Firebase Auth SDK on frontend for proper authentication
    const user = await admin.auth().getUserByEmail(email);
    const userDoc = await admin.firestore().collection('users').doc(user.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    const userData = userDoc.data();
    
    console.log('Login attempt for user:', email);
    console.log('User data from Firestore:', JSON.stringify(userData, null, 2));
    
    // Create JWT token
    const token = jwt.sign(
      { 
        uid: user.uid, 
        email: user.email, 
        role: userData.role 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({ token, role: userData.role });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
