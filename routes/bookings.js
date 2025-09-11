const express = require('express');
const admin = require('../firebaseAdmin');

const router = express.Router();

// Middleware to verify token (for hall owner operations)
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

// POST /api/bookings - Create a new booking (public endpoint for customers)
router.post('/', async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      eventType,
      selectedHall,
      bookingDate,
      startTime,
      endTime,
      additionalDescription,
      hallOwnerId,
      estimatedPrice
    } = req.body;

    // Validate required fields
    if (!customerName || !customerEmail || !customerPhone || !eventType || !selectedHall || !bookingDate || !startTime || !endTime || !hallOwnerId) {
      return res.status(400).json({
        message: 'Missing required fields: customerName, customerEmail, customerPhone, eventType, selectedHall, bookingDate, startTime, endTime, hallOwnerId'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate phone format (basic validation)
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    if (!phoneRegex.test(customerPhone.replace(/[\s\-\(\)]/g, ''))) {
      return res.status(400).json({ message: 'Invalid phone number format' });
    }

    // Validate date format and ensure it's not in the past
    const bookingDateObj = new Date(bookingDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (isNaN(bookingDateObj.getTime())) {
      return res.status(400).json({ message: 'Invalid booking date format' });
    }
    
    if (bookingDateObj < today) {
      return res.status(400).json({ message: 'Booking date cannot be in the past' });
    }

    // Validate time format
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return res.status(400).json({ message: 'Invalid time format. Use HH:MM format' });
    }

    // Validate that end time is after start time
    const startTimeObj = new Date(`2000-01-01T${startTime}:00`);
    const endTimeObj = new Date(`2000-01-01T${endTime}:00`);
    
    if (endTimeObj <= startTimeObj) {
      return res.status(400).json({ message: 'End time must be after start time' });
    }

    // Verify hall owner exists
    const hallOwnerDoc = await admin.firestore().collection('users').doc(hallOwnerId).get();
    if (!hallOwnerDoc.exists) {
      return res.status(404).json({ message: 'Hall owner not found' });
    }

    const hallOwnerData = hallOwnerDoc.data();
    if (hallOwnerData.role !== 'hall_owner') {
      return res.status(404).json({ message: 'Hall owner not found' });
    }

    // Verify selected hall exists and belongs to the hall owner
    const hallDoc = await admin.firestore().collection('resources').doc(selectedHall).get();
    if (!hallDoc.exists) {
      return res.status(404).json({ message: 'Selected hall not found' });
    }

    const hallData = hallDoc.data();
    if (hallData.hallOwnerId !== hallOwnerId) {
      return res.status(400).json({ message: 'Selected hall does not belong to the specified hall owner' });
    }

    // Check for conflicting bookings
    const conflictingBookings = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', hallOwnerId)
      .where('selectedHall', '==', selectedHall)
      .where('bookingDate', '==', bookingDate)
      .where('status', 'in', ['pending', 'confirmed'])
      .get();

    // Check for time conflicts
    for (const bookingDoc of conflictingBookings.docs) {
      const booking = bookingDoc.data();
      const existingStart = new Date(`2000-01-01T${booking.startTime}:00`);
      const existingEnd = new Date(`2000-01-01T${booking.endTime}:00`);
      
      // Check if times overlap
      if ((startTimeObj < existingEnd && endTimeObj > existingStart)) {
        return res.status(409).json({
          message: 'Time slot is already booked. Please choose a different time.',
          conflictingBooking: {
            startTime: booking.startTime,
            endTime: booking.endTime,
            customerName: booking.customerName
          }
        });
      }
    }

    // Calculate booking price
    let calculatedPrice = 0;
    let priceDetails = null;
    
    try {
      // Get pricing for the selected hall
      const pricingSnapshot = await admin.firestore()
        .collection('pricing')
        .where('hallOwnerId', '==', hallOwnerId)
        .where('resourceId', '==', selectedHall)
        .get();
      
      if (!pricingSnapshot.empty) {
        const pricingData = pricingSnapshot.docs[0].data();
        
        // Calculate duration in hours
        const startTimeObj = new Date(`2000-01-01T${startTime}:00`);
        const endTimeObj = new Date(`2000-01-01T${endTime}:00`);
        const durationHours = (endTimeObj.getTime() - startTimeObj.getTime()) / (1000 * 60 * 60);
        
        // Check if it's weekend (Saturday = 6, Sunday = 0)
        const bookingDateObj = new Date(bookingDate);
        const isWeekend = bookingDateObj.getDay() === 0 || bookingDateObj.getDay() === 6;
        
        const rate = isWeekend ? pricingData.weekendRate : pricingData.weekdayRate;
        
        if (pricingData.rateType === 'hourly') {
          calculatedPrice = rate * durationHours;
        } else {
          // For daily rates, assume minimum 4 hours for half day, 8+ hours for full day
          calculatedPrice = durationHours >= 8 ? rate : rate * 0.5;
        }
        
        priceDetails = {
          rateType: pricingData.rateType,
          weekdayRate: pricingData.weekdayRate,
          weekendRate: pricingData.weekendRate,
          appliedRate: rate,
          durationHours: durationHours,
          isWeekend: isWeekend,
          calculationMethod: pricingData.rateType === 'hourly' ? 'hourly' : 'daily',
          frontendEstimatedPrice: estimatedPrice || null
        };
        
        console.log('Price calculation details:', {
          resourceId: selectedHall,
          rateType: pricingData.rateType,
          weekdayRate: pricingData.weekdayRate,
          weekendRate: pricingData.weekendRate,
          appliedRate: rate,
          durationHours: durationHours,
          isWeekend: isWeekend,
          calculatedPrice: calculatedPrice,
          frontendEstimatedPrice: estimatedPrice
        });
      }
    } catch (priceError) {
      console.error('Error calculating price:', priceError);
      // Continue with booking even if price calculation fails
    }

    // Create booking data
    const bookingData = {
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      customerPhone: customerPhone.trim(),
      eventType: eventType.trim(),
      selectedHall: selectedHall,
      hallName: hallData.name, // Store hall name for easier reference
      bookingDate: bookingDate,
      startTime: startTime,
      endTime: endTime,
      additionalDescription: additionalDescription ? additionalDescription.trim() : '',
      hallOwnerId: hallOwnerId,
      status: 'pending', // New bookings start as pending
      calculatedPrice: calculatedPrice,
      priceDetails: priceDetails,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Save to Firestore
    const docRef = await admin.firestore().collection('bookings').add(bookingData);

    // Get the created booking with ID
    const createdBooking = {
      id: docRef.id,
      ...bookingData,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    res.status(201).json({
      message: 'Booking request submitted successfully',
      booking: createdBooking
    });

  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/bookings/hall-owner/:hallOwnerId - Get all bookings for a hall owner (requires authentication)
router.get('/hall-owner/:hallOwnerId', verifyToken, async (req, res) => {
  try {
    const { hallOwnerId } = req.params;
    const userId = req.user.uid;

    // Verify the authenticated user is the hall owner
    if (userId !== hallOwnerId) {
      return res.status(403).json({ message: 'Access denied. You can only view your own bookings.' });
    }

    // Get user data to verify they are a hall_owner
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners can view bookings.' });
    }

    // Get all bookings for this hall owner
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', hallOwnerId)
      .orderBy('createdAt', 'desc')
      .get();

    const bookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    res.json(bookings);

  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/bookings/:id/status - Update booking status (hall owner only)
router.put('/:id/status', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.uid;

    // Validate status
    if (!['pending', 'confirmed', 'cancelled', 'completed'].includes(status)) {
      return res.status(400).json({
        message: 'Invalid status. Must be one of: pending, confirmed, cancelled, completed'
      });
    }

    // Get booking
    const bookingDoc = await admin.firestore().collection('bookings').doc(id).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const bookingData = bookingDoc.data();
    
    // Verify the authenticated user is the hall owner
    if (bookingData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only update your own bookings.' });
    }

    // Get user data to verify they are a hall_owner
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners can update booking status.' });
    }

    // Update booking status
    await admin.firestore().collection('bookings').doc(id).update({
      status: status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      message: 'Booking status updated successfully',
      bookingId: id,
      newStatus: status
    });

  } catch (error) {
    console.error('Error updating booking status:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/bookings/:id/price - Update booking price (hall owner only)
router.put('/:id/price', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { calculatedPrice, priceDetails, notes } = req.body;
    const userId = req.user.uid;

    // Validate price
    if (calculatedPrice !== undefined && (typeof calculatedPrice !== 'number' || calculatedPrice < 0)) {
      return res.status(400).json({
        message: 'Calculated price must be a non-negative number'
      });
    }

    // Get booking
    const bookingDoc = await admin.firestore().collection('bookings').doc(id).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const bookingData = bookingDoc.data();
    
    // Verify the authenticated user is the hall owner
    if (bookingData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only update your own bookings.' });
    }

    // Get user data to verify they are a hall_owner
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners can update booking prices.' });
    }

    // Prepare update data
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (calculatedPrice !== undefined) updateData.calculatedPrice = calculatedPrice;
    if (priceDetails !== undefined) updateData.priceDetails = priceDetails;
    if (notes !== undefined) updateData.priceNotes = notes;

    // Update booking price
    await admin.firestore().collection('bookings').doc(id).update(updateData);

    res.json({
      message: 'Booking price updated successfully',
      bookingId: id,
      updatedPrice: calculatedPrice
    });

  } catch (error) {
    console.error('Error updating booking price:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/bookings/:id - Get a specific booking (hall owner only)
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    // Get booking
    const bookingDoc = await admin.firestore().collection('bookings').doc(id).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const bookingData = bookingDoc.data();
    
    // Verify the authenticated user is the hall owner
    if (bookingData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only view your own bookings.' });
    }

    // Get user data to verify they are a hall_owner
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners can view bookings.' });
    }

    res.json({
      id: bookingDoc.id,
      ...bookingData,
      createdAt: bookingData.createdAt?.toDate?.() || null,
      updatedAt: bookingData.updatedAt?.toDate?.() || null
    });

  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/bookings/unavailable-dates/:hallOwnerId - Get unavailable dates for calendar (public endpoint)
router.get('/unavailable-dates/:hallOwnerId', async (req, res) => {
  try {
    const { hallOwnerId } = req.params;
    const { resourceId, startDate, endDate } = req.query;
    
    console.log('Fetching unavailable dates for hallOwnerId:', hallOwnerId);
    console.log('Query params:', { resourceId, startDate, endDate });
    
    // Validate hall owner exists
    const userDoc = await admin.firestore().collection('users').doc(hallOwnerId).get();
    if (!userDoc.exists) {
      console.log('Hall owner not found:', hallOwnerId);
      return res.status(404).json({ message: 'Hall owner not found' });
    }

    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      console.log('User is not a hall owner:', userData.role);
      return res.status(404).json({ message: 'Hall owner not found' });
    }

    console.log('Hall owner validated:', userData.name || userData.businessName);

    // Get all bookings for this hall owner first, then filter in memory
    // This avoids complex Firestore query issues
    let query = admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', hallOwnerId);

    console.log('Executing Firestore query...');
    const bookingsSnapshot = await query.get();
    console.log('Found', bookingsSnapshot.docs.length, 'total bookings');
    
    // Filter bookings in memory
    const filteredBookings = bookingsSnapshot.docs.filter(doc => {
      const booking = doc.data();
      
      // Filter by status
      if (!['pending', 'confirmed'].includes(booking.status)) {
        return false;
      }
      
      // Filter by resource if specified
      if (resourceId && booking.selectedHall !== resourceId) {
        return false;
      }
      
      // Filter by date range if specified
      if (startDate && booking.bookingDate < startDate) {
        return false;
      }
      if (endDate && booking.bookingDate > endDate) {
        return false;
      }
      
      return true;
    });
    
    console.log('Filtered to', filteredBookings.length, 'active bookings');
    
    // Group bookings by date and resource
    const unavailableDates = {};
    
    filteredBookings.forEach(doc => {
      const booking = doc.data();
      const bookingDate = booking.bookingDate;
      const selectedHall = booking.selectedHall;
      
      if (!bookingDate || !selectedHall) {
        console.log('Skipping booking with missing data:', booking);
        return;
      }
      
      if (!unavailableDates[bookingDate]) {
        unavailableDates[bookingDate] = {};
      }
      
      if (!unavailableDates[bookingDate][selectedHall]) {
        unavailableDates[bookingDate][selectedHall] = [];
      }
      
      unavailableDates[bookingDate][selectedHall].push({
        bookingId: doc.id,
        startTime: booking.startTime || 'N/A',
        endTime: booking.endTime || 'N/A',
        customerName: booking.customerName || 'Unknown',
        eventType: booking.eventType || 'Unknown',
        status: booking.status || 'Unknown'
      });
    });

    console.log('Processed unavailable dates:', Object.keys(unavailableDates));

    res.json({
      unavailableDates,
      totalBookings: filteredBookings.length,
      message: 'Successfully fetched unavailable dates'
    });

  } catch (error) {
    console.error('Error fetching unavailable dates:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Internal server error while fetching unavailable dates',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// GET /api/bookings/test - Simple test endpoint
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Bookings API is working!',
    timestamp: new Date().toISOString(),
    status: 'OK'
  });
});

module.exports = router;
