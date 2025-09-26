const express = require('express');
const admin = require('../firebaseAdmin');
const emailService = require('../services/emailService');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Middleware to verify token (for hall owner operations)
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    // Try to verify as JWT first, then Firebase token
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

// Helper function to generate invoice number
const generateInvoiceNumber = () => {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `INV-${year}${month}-${random}`;
};

// Helper function to calculate GST
const calculateGST = (amount) => {
  const gstRate = 0.1; // 10% GST
  const gst = Math.round(amount * gstRate * 100) / 100;
  return gst;
};

// Helper function to generate invoice PDF
async function generateInvoicePDF(invoiceData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 40,
        size: 'A4',
        layout: 'portrait'
      });
      const buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Define colors
      const primaryColor = '#2563eb'; // Blue
      const secondaryColor = '#64748b'; // Gray
      const accentColor = '#059669'; // Green
      const lightGray = '#f1f5f9';
      const darkGray = '#334155';

      // Header with gradient-like effect
      doc.rect(0, 0, 595, 120)
         .fill(primaryColor);
      
      // Company logo area (placeholder)
      doc.rect(40, 20, 60, 60)
         .fill('#ffffff')
         .stroke(primaryColor, 2);
      
      doc.fillColor('#ffffff')
         .fontSize(24)
         .font('Helvetica-Bold')
         .text('Cranbourne', 120, 30)
         .fontSize(18)
         .text('Public Hall', 120, 55);
      
      // Invoice title
      doc.fillColor('#ffffff')
         .fontSize(28)
         .font('Helvetica-Bold')
         .text('INVOICE', 50, 45, { width: 495, align: 'right' });

      // Invoice details box
      doc.rect(40, 140, 515, 80)
         .fill(lightGray)
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('INVOICE DETAILS', 50, 150);
      
      doc.fillColor(secondaryColor)
         .fontSize(10)
         .font('Helvetica')
         .text(`Invoice Number: ${invoiceData.invoiceNumber}`, 50, 170)
         .text(`Issue Date: ${invoiceData.issueDate ? new Date(invoiceData.issueDate).toLocaleDateString('en-AU') : new Date().toLocaleDateString('en-AU')}`, 50, 185)
         .text(`Due Date: ${invoiceData.dueDate ? new Date(invoiceData.dueDate).toLocaleDateString('en-AU') : 'N/A'}`, 50, 200);

      // Customer details section
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('BILL TO', 50, 250);
      
      doc.rect(50, 260, 240, 100)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(11)
         .font('Helvetica-Bold')
         .text(invoiceData.customer.name, 60, 275);
      
      doc.fillColor(secondaryColor)
         .fontSize(10)
         .font('Helvetica')
         .text(invoiceData.customer.email, 60, 295)
         .text(invoiceData.customer.phone, 60, 310)
         .text('Customer', 60, 340, { width: 220, align: 'center' });

      // Invoice details section
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('INVOICE INFORMATION', 310, 250);
      
      doc.rect(310, 260, 245, 100)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(11)
         .font('Helvetica-Bold')
         .text(invoiceData.invoiceType, 320, 275);
      
      doc.fillColor(secondaryColor)
         .fontSize(10)
         .font('Helvetica')
         .text(invoiceData.resource, 320, 295)
         .text(`Booking ID: ${invoiceData.bookingId}`, 320, 310)
         .text(`Type: ${invoiceData.invoiceType}`, 320, 325);

      // Line items table
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('INVOICE ITEMS', 50, 380);
      
      // Table header
      doc.rect(50, 390, 505, 25)
         .fill(primaryColor);
      
      doc.fillColor('#ffffff')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('Description', 60, 398)
         .text('Qty', 350, 398)
         .text('Unit Price', 400, 398)
         .text('Amount', 500, 398, { width: 45, align: 'right' });

      // Table row
      doc.rect(50, 415, 505, 30)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(10)
         .font('Helvetica')
         .text(invoiceData.description, 60, 425, { width: 280 })
         .text('1', 350, 425)
         .text(`$${invoiceData.subtotal.toFixed(2)}`, 400, 425)
         .text(`$${invoiceData.subtotal.toFixed(2)}`, 500, 425, { width: 45, align: 'right' });

      // Totals section
      doc.rect(350, 460, 205, 80)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(11)
         .font('Helvetica')
         .text('Subtotal:', 360, 470)
         .text(`$${invoiceData.subtotal.toFixed(2)}`, 500, 470, { width: 45, align: 'right' })
         .text('GST (10%):', 360, 485)
         .text(`$${invoiceData.gst.toFixed(2)}`, 500, 485, { width: 45, align: 'right' });
      
      doc.rect(350, 500, 205, 40)
         .fill(accentColor);
      
      doc.fillColor('#ffffff')
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('TOTAL AMOUNT', 360, 510)
         .fontSize(20)
         .text(`$${invoiceData.total.toFixed(2)} AUD`, 360, 525, { width: 185, align: 'right' });

      // Payment information
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('PAYMENT INFORMATION', 50, 560);
      
      doc.rect(50, 570, 505, 60)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      doc.fillColor(secondaryColor)
         .fontSize(10)
         .font('Helvetica')
         .text('Payment Method: Bank Transfer', 60, 580)
         .text('Account Name: Cranbourne Public Hall', 60, 595)
         .text('BSB: 123-456', 60, 610)
         .text('Account Number: 12345678', 60, 625);

      // Notes section (if exists, make it more compact)
      if (invoiceData.notes) {
        doc.fillColor(primaryColor)
           .fontSize(12)
           .font('Helvetica-Bold')
           .text('ADDITIONAL NOTES', 50, 560);
        
        doc.rect(50, 570, 505, 30)
           .fill('#ffffff')
           .stroke(secondaryColor, 1);
        
        doc.fillColor(secondaryColor)
           .fontSize(9)
           .font('Helvetica')
           .text(invoiceData.notes, 60, 580, { width: 485 });
      }

      // Terms and conditions (more compact)
      const notesHeight = invoiceData.notes ? 40 : 0;
      doc.fillColor(primaryColor)
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('TERMS & CONDITIONS', 50, 560 + notesHeight);
      
      doc.fillColor(secondaryColor)
         .fontSize(8)
         .font('Helvetica')
         .text('• Payment is due within 30 days of invoice date.', 50, 580 + notesHeight)
         .text('• Late payments may incur additional charges.', 50, 592 + notesHeight)
         .text('• All prices include GST where applicable.', 50, 604 + notesHeight)
         .text('• For payment inquiries, please contact us directly.', 50, 616 + notesHeight);

      // Footer (more compact)
      const footerY = 640 + notesHeight;
      doc.rect(0, footerY, 595, 30)
         .fill(lightGray);
      
      doc.fillColor(secondaryColor)
         .fontSize(7)
         .font('Helvetica')
         .text('Cranbourne Public Hall • Professional Event Management', 50, footerY + 8, { width: 495, align: 'center' })
         .text('Contact: info@cranbournehall.com.au • Phone: (03) 1234 5678', 50, footerY + 18, { width: 495, align: 'center' });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// POST /api/invoices - Create a new invoice from booking
router.post('/', verifyToken, async (req, res) => {
  try {
    const {
      bookingId,
      invoiceType, // 'DEPOSIT', 'FINAL', 'BOND', 'ADD-ONS'
      amount,
      description,
      dueDate,
      notes
    } = req.body;

    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate required fields
    if (!bookingId || !invoiceType || !amount) {
      return res.status(400).json({
        message: 'Missing required fields: bookingId, invoiceType, amount'
      });
    }

    // Validate invoice type
    if (!['DEPOSIT', 'FINAL', 'BOND', 'ADD-ONS'].includes(invoiceType)) {
      return res.status(400).json({
        message: 'Invalid invoice type. Must be one of: DEPOSIT, FINAL, BOND, ADD-ONS'
      });
    }

    // Get booking details
    const bookingDoc = await admin.firestore().collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const bookingData = bookingDoc.data();

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = bookingData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== bookingData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only create invoices for your parent hall owner\'s bookings.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (bookingData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only create invoices for your own bookings.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can create invoices.' });
    }

    // Check if invoice already exists for this booking and type
    const existingInvoice = await admin.firestore()
      .collection('invoices')
      .where('bookingId', '==', bookingId)
      .where('invoiceType', '==', invoiceType)
      .where('status', 'in', ['DRAFT', 'SENT', 'PARTIAL', 'PAID'])
      .get();

    if (!existingInvoice.empty) {
      return res.status(409).json({
        message: `Invoice of type ${invoiceType} already exists for this booking`
      });
    }

    // Calculate amounts
    const subtotal = parseFloat(amount);
    const gst = calculateGST(subtotal);
    const total = subtotal + gst;

    // Create invoice data
    const invoiceData = {
      invoiceNumber: generateInvoiceNumber(),
      bookingId: bookingId,
      invoiceType: invoiceType,
      customer: {
        name: bookingData.customerName,
        email: bookingData.customerEmail,
        phone: bookingData.customerPhone,
        abn: null // Could be added to customer data later
      },
      hallOwnerId: actualHallOwnerId,
      resource: bookingData.hallName || bookingData.selectedHall,
      issueDate: new Date(),
      dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      subtotal: subtotal,
      gst: gst,
      total: total,
      paidAmount: 0,
      status: 'DRAFT',
      description: description || `${bookingData.eventType} - ${invoiceType} Payment`,
      lineItems: [
        {
          description: description || `${bookingData.eventType} - ${invoiceType.toLowerCase()} payment`,
          quantity: 1,
          unitPrice: subtotal,
          gstRate: 0.1,
          gstAmount: gst
        }
      ],
      notes: notes || '',
      sentAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Save to Firestore
    const docRef = await admin.firestore().collection('invoices').add(invoiceData);

    console.log('Invoice created successfully:', {
      invoiceId: docRef.id,
      invoiceNumber: invoiceData.invoiceNumber,
      bookingId: bookingId,
      invoiceType: invoiceType,
      total: total
    });

    // Log invoice creation
    const AuditService = require('../services/auditService');
    await AuditService.logInvoiceCreated(
      userId,
      req.user.email,
      userData.role,
      {
        id: docRef.id,
        invoiceNumber: invoiceData.invoiceNumber,
        bookingId: bookingId,
        invoiceType: invoiceType,
        total: total
      },
      ipAddress,
      actualHallOwnerId
    );

    res.status(201).json({
      message: 'Invoice created successfully',
      invoice: {
        id: docRef.id,
        ...invoiceData,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error creating invoice:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/invoices/hall-owner/:hallOwnerId - Get all invoices for a hall owner
router.get('/hall-owner/:hallOwnerId', verifyToken, async (req, res) => {
  try {
    const { hallOwnerId } = req.params;
    const userId = req.user.uid;

    console.log('Invoice GET - Request params:', { hallOwnerId, userId });
    console.log('Invoice GET - User from token:', req.user);

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    console.log('Invoice GET - User data from Firestore:', userData);
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s invoices.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (userId !== hallOwnerId) {
        console.log('Invoice GET - Access denied: userId !== hallOwnerId', { userId, hallOwnerId });
        return res.status(403).json({ message: 'Access denied. You can only view your own invoices.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view invoices.' });
    }
    
    console.log('Invoice GET - Access granted, actualHallOwnerId:', actualHallOwnerId);

    // Get all invoices for this hall owner
    const invoicesSnapshot = await admin.firestore()
      .collection('invoices')
      .where('hallOwnerId', '==', actualHallOwnerId)
      .get();

    const invoices = invoicesSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        issueDate: data.issueDate?.toDate?.() || null,
        dueDate: data.dueDate?.toDate?.() || null,
        sentAt: data.sentAt?.toDate?.() || null,
        createdAt: data.createdAt?.toDate?.() || null,
        updatedAt: data.updatedAt?.toDate?.() || null
      };
    });

    // Sort invoices by createdAt in descending order (newest first)
    invoices.sort((a, b) => {
      if (!a.createdAt || !b.createdAt) return 0;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    res.json(invoices);

  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/invoices/:id/status - Update invoice status
router.put('/:id/status', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate status
    if (!['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID', 'REFUNDED'].includes(status)) {
      return res.status(400).json({
        message: 'Invalid status. Must be one of: DRAFT, SENT, PARTIAL, PAID, OVERDUE, VOID, REFUNDED'
      });
    }

    // Get invoice
    const invoiceDoc = await admin.firestore().collection('invoices').doc(id).get();
    if (!invoiceDoc.exists) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoiceData = invoiceDoc.data();
    const oldInvoiceData = { ...invoiceData };
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = invoiceData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== invoiceData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only update your parent hall owner\'s invoices.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (invoiceData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only update your own invoices.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can update invoice status.' });
    }

    // Update invoice status
    const updateData = {
      status: status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // If marking as sent, set sentAt timestamp
    if (status === 'SENT' && invoiceData.status !== 'SENT') {
      updateData.sentAt = admin.firestore.FieldValue.serverTimestamp();
    }

    await admin.firestore().collection('invoices').doc(id).update(updateData);

    // If status is 'SENT', send email with PDF
    if (status === 'SENT' && invoiceData.status !== 'SENT') {
      try {
        const pdfBuffer = await generateInvoicePDF(invoiceData);
        
        // Send email with PDF attachment
        await emailService.sendInvoiceEmail(invoiceData, pdfBuffer);
        console.log('Invoice email sent successfully to:', invoiceData.customer.email);
      } catch (emailError) {
        console.error('Failed to send invoice email:', emailError);
        // Don't fail the status update if email fails
      }
    }

    // Log invoice status update
    const AuditService = require('../services/auditService');
    const newInvoiceData = { ...oldInvoiceData, status: status };
    
    await AuditService.logInvoiceUpdated(
      userId,
      req.user.email,
      userData.role,
      oldInvoiceData,
      newInvoiceData,
      ipAddress,
      actualHallOwnerId
    );

    res.json({
      message: 'Invoice status updated successfully',
      invoiceId: id,
      newStatus: status
    });

  } catch (error) {
    console.error('Error updating invoice status:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/invoices/:id/payment - Record payment for invoice
router.put('/:id/payment', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod, reference, notes } = req.body;
    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate payment amount
    if (!amount || amount <= 0) {
      return res.status(400).json({
        message: 'Payment amount must be greater than 0'
      });
    }

    // Get invoice
    const invoiceDoc = await admin.firestore().collection('invoices').doc(id).get();
    if (!invoiceDoc.exists) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoiceData = invoiceDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = invoiceData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== invoiceData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only record payments for your parent hall owner\'s invoices.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (invoiceData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only record payments for your own invoices.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can record payments.' });
    }

    // Calculate new paid amount
    const newPaidAmount = invoiceData.paidAmount + parseFloat(amount);
    const newStatus = newPaidAmount >= invoiceData.total ? 'PAID' : 
                     newPaidAmount > 0 ? 'PARTIAL' : invoiceData.status;

    // Update invoice
    await admin.firestore().collection('invoices').doc(id).update({
      paidAmount: newPaidAmount,
      status: newStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create payment record
    const paymentData = {
      invoiceId: id,
      invoiceNumber: invoiceData.invoiceNumber,
      bookingId: invoiceData.bookingId,
      hallOwnerId: actualHallOwnerId,
      amount: parseFloat(amount),
      paymentMethod: paymentMethod || 'Bank Transfer',
      reference: reference || '',
      notes: notes || '',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedBy: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const paymentDoc = await admin.firestore().collection('payments').add(paymentData);

    // Log payment recording
    const AuditService = require('../services/auditService');
    await AuditService.logPaymentRecorded(
      userId,
      req.user.email,
      userData.role,
      {
        id: paymentDoc.id,
        invoiceId: id,
        invoiceNumber: invoiceData.invoiceNumber,
        amount: parseFloat(amount),
        paymentMethod: paymentMethod || 'Bank Transfer'
      },
      ipAddress,
      actualHallOwnerId
    );

    res.json({
      message: 'Payment recorded successfully',
      paymentId: paymentDoc.id,
      invoiceId: id,
      newPaidAmount: newPaidAmount,
      newStatus: newStatus
    });

  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/invoices/:id - Get a specific invoice
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    // Get invoice
    const invoiceDoc = await admin.firestore().collection('invoices').doc(id).get();
    if (!invoiceDoc.exists) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoiceData = invoiceDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = invoiceData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== invoiceData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s invoices.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (invoiceData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only view your own invoices.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view invoices.' });
    }

    res.json({
      id: invoiceDoc.id,
      ...invoiceData,
      issueDate: invoiceData.issueDate?.toDate?.() || null,
      dueDate: invoiceData.dueDate?.toDate?.() || null,
      sentAt: invoiceData.sentAt?.toDate?.() || null,
      createdAt: invoiceData.createdAt?.toDate?.() || null,
      updatedAt: invoiceData.updatedAt?.toDate?.() || null
    });

  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/invoices/:id/pdf - Generate and download invoice PDF
router.get('/:id/pdf', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    // Get invoice
    const invoiceDoc = await admin.firestore().collection('invoices').doc(id).get();
    if (!invoiceDoc.exists) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoiceData = invoiceDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = invoiceData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== invoiceData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s invoices.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (invoiceData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only view your own invoices.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view invoices.' });
    }

    // Generate PDF
    const pdfBuffer = await generateInvoicePDF(invoiceData);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceData.invoiceNumber}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating invoice PDF:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
