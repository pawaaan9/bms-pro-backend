const emailService = require('./services/emailService');

async function testBookingEmail() {
  try {
    console.log('Testing booking confirmation email...');
    
    const testBookingData = {
      customerName: 'Test Customer',
      customerEmail: 'pawankanchana99@gmail.com', // Use a real email for testing
      eventType: 'Test Event',
      resource: 'Test Hall',
      eventDate: '2025-01-15',
      startTime: '10:00',
      endTime: '18:00',
      guestCount: 50,
      totalAmount: 500.00,
      bookingId: 'TEST-BOOKING-123',
      quotationId: 'TEST-QUO-456',
      notes: 'Test booking from quotation'
    };

    const result = await emailService.sendBookingConfirmationEmail(testBookingData);
    console.log('✅ Test email sent successfully:', result.messageId);
    
  } catch (error) {
    console.error('❌ Test email failed:', error);
  }
}

testBookingEmail();
