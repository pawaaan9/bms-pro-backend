const express = require('express');
const admin = require('../firebaseAdmin');
const emailService = require('../services/emailService');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Helper function to generate quotation PDF
async function generateQuotationPDF(quotationData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Header
      doc.fontSize(20).text('Cranbourne Public Hall', 50, 50);
      doc.fontSize(16).text('Quotation', 50, 80);
      
      // Quotation details
      doc.fontSize(12);
      doc.text(`Quotation ID: ${quotationData.id}`, 50, 120);
      doc.text(`Date: ${new Date(quotationData.createdAt).toLocaleDateString()}`, 50, 140);
      doc.text(`Valid Until: ${new Date(quotationData.validUntil).toLocaleDateString()}`, 50, 160);
      
      // Customer details
      doc.text('Customer Details:', 50, 200);
      doc.text(`Name: ${quotationData.customerName}`, 70, 220);
      doc.text(`Email: ${quotationData.customerEmail}`, 70, 240);
      doc.text(`Phone: ${quotationData.customerPhone}`, 70, 260);
      
      // Event details
      doc.text('Event Details:', 50, 300);
      doc.text(`Event Type: ${quotationData.eventType}`, 70, 320);
      doc.text(`Resource: ${quotationData.resource}`, 70, 340);
      doc.text(`Event Date: ${new Date(quotationData.eventDate).toLocaleDateString()}`, 70, 360);
      doc.text(`Start Time: ${quotationData.startTime}`, 70, 380);
      doc.text(`End Time: ${quotationData.endTime}`, 70, 400);
      doc.text(`Guest Count: ${quotationData.guestCount || 'N/A'}`, 70, 420);
      
      // Service details
      doc.text('Service Details:', 50, 460);
      doc.text(`Resource: ${quotationData.resource}`, 70, 480);
      doc.text(`Event Type: ${quotationData.eventType}`, 70, 500);
      doc.text(`Duration: ${quotationData.startTime} - ${quotationData.endTime}`, 70, 520);
      if (quotationData.guestCount) {
        doc.text(`Guest Count: ${quotationData.guestCount}`, 70, 540);
      }
      
      // Total
      doc.fontSize(14).text(`Total Amount: $${quotationData.totalAmount.toFixed(2)} AUD`, 50, 580);
      
      // Terms and conditions
      doc.fontSize(10).text('Terms and Conditions:', 50, 620);
      doc.text('• This quotation is valid until the date specified above.', 70, 640);
      doc.text('• Payment terms: 50% deposit required to confirm booking.', 70, 655);
      doc.text('• Cancellation policy applies as per venue terms.', 70, 670);
      doc.text('• Prices are subject to change without notice.', 70, 685);
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// Middleware to verify token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      req.user = decoded;
      next();
    } catch (jwtError) {
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.user = decodedToken;
      next();
    }
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
};

// POST /api/quotations - Create a new quotation
router.post('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.user_id;
    const {
      customerName,
      customerEmail,
      customerPhone,
      eventType,
      resource,
      eventDate,
      startTime,
      endTime,
      guestCount,
      totalAmount,
      validUntil,
      notes
    } = req.body;

    // Validate required fields
    if (!customerName || !customerEmail || !customerPhone || !eventType || !resource || !eventDate || !startTime || !endTime || !totalAmount) {
      return res.status(400).json({
        message: 'Missing required fields'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = userId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
    } else if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can create quotations.' });
    }

    // Generate quotation ID
    const quotationId = `QUO-${Date.now().toString().slice(-6)}`;

    // Create quotation data
    const quotationData = {
      id: quotationId,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      customerPhone: customerPhone.trim(),
      eventType: eventType.trim(),
      resource: resource,
      eventDate: eventDate,
      startTime: startTime,
      endTime: endTime,
      guestCount: guestCount ? parseInt(guestCount) : null,
      totalAmount: parseFloat(totalAmount),
      validUntil: validUntil || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
      status: 'Draft',
      notes: notes || '',
      hallOwnerId: actualHallOwnerId,
      createdBy: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Save to Firestore
    const docRef = await admin.firestore().collection('quotations').add(quotationData);

    console.log('Quotation created successfully:', {
      quotationId: docRef.id,
      customerName: customerName,
      customerEmail: customerEmail,
      hallOwnerId: actualHallOwnerId,
      createdBy: userId
    });

    // Log quotation creation
    const AuditService = require('../services/auditService');
    await AuditService.logQuotationCreated(
      userId,
      req.user.email,
      userData.role,
      {
        id: docRef.id,
        quotationId: quotationId,
        customerName: customerName,
        eventType: eventType,
        totalAmount: totalAmount
      },
      req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
      actualHallOwnerId
    );

    res.status(201).json({
      message: 'Quotation created successfully',
      quotation: {
        id: docRef.id,
        ...quotationData,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error creating quotation:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/quotations/my-quotations - Get all quotations for the current user
router.get('/my-quotations', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.user_id;

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = userId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
    } else if (userData.role === 'hall_owner') {
      actualHallOwnerId = userId;
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view quotations.' });
    }

    // Get all quotations for this hall owner
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('hallOwnerId', '==', actualHallOwnerId)
      .get();

    const quotations = quotationsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || null,
        updatedAt: data.updatedAt?.toDate?.() || null
      };
    });

    // Sort quotations by createdAt in descending order (newest first)
    quotations.sort((a, b) => {
      if (!a.createdAt || !b.createdAt) return 0;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    res.json(quotations);

  } catch (error) {
    console.error('Error fetching quotations:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/quotations/hall-owner/:hallOwnerId - Get all quotations for a hall owner (legacy endpoint)
router.get('/hall-owner/:hallOwnerId', verifyToken, async (req, res) => {
  try {
    const { hallOwnerId } = req.params;
    const userId = req.user.uid || req.user.user_id;

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = userId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
    } else if (userData.role === 'hall_owner') {
      actualHallOwnerId = userId;
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view quotations.' });
    }

    // Get all quotations for this hall owner
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('hallOwnerId', '==', actualHallOwnerId)
      .get();

    const quotations = quotationsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || null,
        updatedAt: data.updatedAt?.toDate?.() || null
      };
    });

    // Sort quotations by createdAt in descending order (newest first)
    quotations.sort((a, b) => {
      if (!a.createdAt || !b.createdAt) return 0;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    res.json(quotations);

  } catch (error) {
    console.error('Error fetching quotations:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/quotations/:id/status - Update quotation status
router.put('/:id/status', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.uid || req.user.user_id;

    // Validate status
    if (!['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'].includes(status)) {
      return res.status(400).json({
        message: 'Invalid status. Must be one of: Draft, Sent, Accepted, Declined, Expired'
      });
    }

    // Get quotation by custom ID field
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('id', '==', id)
      .limit(1)
      .get();
    
    if (quotationsSnapshot.empty) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const quotationDoc = quotationsSnapshot.docs[0];
    const quotationData = quotationDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = quotationData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== quotationData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only update your parent hall owner\'s quotations.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (quotationData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only update your own quotations.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can update quotation status.' });
    }

    // Update quotation status
    await quotationDoc.ref.update({
      status: status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // If status is 'Sent', send email with PDF
    if (status === 'Sent') {
      try {
        const pdfBuffer = await generateQuotationPDF(quotationData);
        
        // Send email with PDF attachment
        await emailService.sendQuotationEmail(quotationData, pdfBuffer);
        console.log('Quotation email sent successfully to:', quotationData.customerEmail);
      } catch (emailError) {
        console.error('Failed to send quotation email:', emailError);
        // Don't fail the status update if email fails
      }
    }

    // If status is 'Declined', send decline notification email
    if (status === 'Declined') {
      try {
        const EmailService = require('../services/emailService');
        await EmailService.sendQuotationDeclineEmail({
          customerName: quotationData.customerName,
          customerEmail: quotationData.customerEmail,
          eventType: quotationData.eventType,
          resource: quotationData.resource,
          eventDate: quotationData.eventDate,
          quotationId: quotationData.id
        });
        
        console.log('Quotation decline email sent successfully to:', quotationData.customerEmail);
      } catch (emailError) {
        console.error('Failed to send quotation decline email:', emailError);
        // Don't fail the status update if email fails
      }
    }

    // If status is 'Accepted', convert to booking
    if (status === 'Accepted') {
      try {
        // Create booking from quotation
        const bookingData = {
          customerId: null,
          customerName: quotationData.customerName,
          customerEmail: quotationData.customerEmail,
          customerPhone: quotationData.customerPhone,
          customerAvatar: null,
          eventType: quotationData.eventType,
          selectedHall: quotationData.resource,
          hallName: quotationData.resource, // You might want to get the actual hall name
          bookingDate: quotationData.eventDate,
          startTime: quotationData.startTime,
          endTime: quotationData.endTime,
          additionalDescription: quotationData.notes || '',
          guestCount: quotationData.guestCount,
          hallOwnerId: actualHallOwnerId,
          status: 'confirmed', // Accepted quotations become confirmed bookings
          calculatedPrice: quotationData.totalAmount,
          priceDetails: {
            quotationId: quotationData.id,
            source: 'quotation_accepted'
          },
          bookingSource: 'quotation',
          quotationId: quotationData.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const bookingDocRef = await admin.firestore().collection('bookings').add(bookingData);
        
        // Update quotation with booking reference
        await quotationDoc.ref.update({
          bookingId: bookingDocRef.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('Quotation converted to booking:', {
          quotationId: id,
          bookingId: bookingDocRef.id,
          customerName: quotationData.customerName
        });

        // Send booking confirmation email
        try {
          const EmailService = require('../services/emailService');
          await EmailService.sendBookingConfirmationEmail({
            customerName: quotationData.customerName,
            customerEmail: quotationData.customerEmail,
            eventType: quotationData.eventType,
            resource: quotationData.resource,
            eventDate: quotationData.eventDate,
            startTime: quotationData.startTime,
            endTime: quotationData.endTime,
            guestCount: quotationData.guestCount,
            totalAmount: quotationData.totalAmount,
            bookingId: bookingDocRef.id,
            quotationId: quotationData.id,
            notes: quotationData.notes
          });
          
          console.log('Booking confirmation email sent successfully:', {
            customerEmail: quotationData.customerEmail,
            bookingId: bookingDocRef.id
          });
        } catch (emailError) {
          console.error('Failed to send booking confirmation email:', emailError);
          // Don't fail the booking creation if email fails
        }

        // Log booking creation from quotation
        const AuditService = require('../services/auditService');
        await AuditService.logBookingCreated(
          userId,
          req.user.email,
          userData.role,
          {
            id: bookingDocRef.id,
            customerName: quotationData.customerName,
            eventDate: quotationData.eventDate,
            status: 'confirmed',
            totalAmount: quotationData.totalAmount,
            source: 'quotation_accepted'
          },
          req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
          actualHallOwnerId
        );

      } catch (conversionError) {
        console.error('Error converting quotation to booking:', conversionError);
        // Don't fail the status update if conversion fails
      }
    }

    res.json({
      message: 'Quotation status updated successfully',
      quotationId: id,
      newStatus: status
    });

  } catch (error) {
    console.error('Error updating quotation status:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/quotations/:id - Get a specific quotation
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid || req.user.user_id;

    // Get quotation by custom ID field
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('id', '==', id)
      .limit(1)
      .get();
    
    if (quotationsSnapshot.empty) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const quotationDoc = quotationsSnapshot.docs[0];
    const quotationData = quotationDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = quotationData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== quotationData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s quotations.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (quotationData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only view your own quotations.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view quotations.' });
    }

    res.json({
      id: quotationDoc.id,
      ...quotationData,
      createdAt: quotationData.createdAt?.toDate?.() || null,
      updatedAt: quotationData.updatedAt?.toDate?.() || null
    });

  } catch (error) {
    console.error('Error fetching quotation:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/quotations/:id - Update a quotation
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const userId = req.user.uid || req.user.user_id;

    // Get quotation by custom ID field
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('id', '==', id)
      .limit(1)
      .get();
    
    if (quotationsSnapshot.empty) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const quotationDoc = quotationsSnapshot.docs[0];
    const quotationData = quotationDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = quotationData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== quotationData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only update your parent hall owner\'s quotations.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (quotationData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only update your own quotations.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can update quotations.' });
    }

    // Prepare update data
    const finalUpdateData = {
      ...updateData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Update quotation
    await quotationDoc.ref.update(finalUpdateData);

    res.json({
      message: 'Quotation updated successfully',
      quotationId: id
    });

  } catch (error) {
    console.error('Error updating quotation:', error);
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/quotations/:id - Delete a quotation
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid || req.user.user_id;

    // Get quotation by custom ID field
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('id', '==', id)
      .limit(1)
      .get();
    
    if (quotationsSnapshot.empty) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const quotationDoc = quotationsSnapshot.docs[0];
    const quotationData = quotationDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = quotationData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== quotationData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only delete your parent hall owner\'s quotations.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (quotationData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only delete your own quotations.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can delete quotations.' });
    }

    // Delete quotation
    await quotationDoc.ref.delete();

    res.json({
      message: 'Quotation deleted successfully',
      quotationId: id
    });

  } catch (error) {
    console.error('Error deleting quotation:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/quotations/:id/pdf - Generate and download quotation PDF
router.get('/:id/pdf', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid || req.user.user_id;

    // Get quotation by custom ID field
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('id', '==', id)
      .limit(1)
      .get();
    
    if (quotationsSnapshot.empty) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const quotationDoc = quotationsSnapshot.docs[0];
    const quotationData = quotationDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = quotationData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== quotationData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s quotations.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (quotationData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only view your own quotations.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view quotations.' });
    }

    // Generate PDF
    const pdfBuffer = await generateQuotationPDF(quotationData);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="quotation-${quotationData.id}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating quotation PDF:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
