const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    // Configure nodemailer with Gmail SMTP
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'pawankanchana34741@gmail.com',
        pass: 'ijzu oxwl nuok hdxv' // App-specific password
      }
    });

    // Verify transporter configuration
    this.verifyConnection();
  }

  async verifyConnection() {
    try {
      await this.transporter.verify();
      console.log('✅ Email service connected successfully');
    } catch (error) {
      console.error('❌ Email service connection failed:', error);
    }
  }

  async sendNotificationEmail(notificationData, userEmail) {
    try {
      const { type, title, message, data } = notificationData;
      
      // Generate email content based on notification type
      const emailContent = this.generateEmailContent(type, title, message, data);
      
      const mailOptions = {
        from: 'pawankanchana34741@gmail.com',
        to: userEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ Failed to send email:', error);
      throw error;
    }
  }

  generateEmailContent(type, title, message, data) {
    const baseTemplate = {
      subject: `Cranbourne Public Hall - ${title}`,
      text: message,
      html: this.generateHTMLTemplate(type, title, message, data)
    };

    return baseTemplate;
  }

  generateHTMLTemplate(type, title, message, data) {
    const logoUrl = 'https://via.placeholder.com/200x80/4F46E5/FFFFFF?text=Cranbourne+Hall';
    
    let actionButton = '';
    let bookingDetails = '';
    
    // Add booking details if available
    if (data && data.bookingId) {
      bookingDetails = `
        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #1e293b; margin: 0 0 15px 0;">Booking Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Booking ID:</td>
              <td style="padding: 8px 0; color: #1e293b;">${data.bookingId}</td>
            </tr>
            ${data.eventType ? `
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Event Type:</td>
              <td style="padding: 8px 0; color: #1e293b;">${data.eventType}</td>
            </tr>
            ` : ''}
            ${data.bookingDate ? `
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Date:</td>
              <td style="padding: 8px 0; color: #1e293b;">${data.bookingDate}</td>
            </tr>
            ` : ''}
            ${data.startTime ? `
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Time:</td>
              <td style="padding: 8px 0; color: #1e293b;">${data.startTime}${data.endTime ? ` - ${data.endTime}` : ''}</td>
            </tr>
            ` : ''}
            ${data.calculatedPrice ? `
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Price:</td>
              <td style="padding: 8px 0; color: #059669; font-weight: bold;">$${data.calculatedPrice.toFixed(2)}</td>
            </tr>
            ` : ''}
          </table>
        </div>
      `;
    }

    // Add action button based on notification type
    switch (type) {
      case 'booking_submitted':
        actionButton = `
          <div style="text-align: center; margin: 30px 0;">
            <p style="color: #64748b; margin-bottom: 20px;">We'll review your booking and get back to you soon!</p>
            <a href="https://cranbourne-public-hall.vercel.app/booknow" 
               style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              View Booking Status
            </a>
          </div>
        `;
        break;
      case 'booking_confirmed':
        actionButton = `
          <div style="text-align: center; margin: 30px 0;">
            <p style="color: #059669; margin-bottom: 20px;">🎉 Your booking has been confirmed!</p>
            <a href="https://cranbourne-public-hall.vercel.app/booknow" 
               style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              View Booking Details
            </a>
          </div>
        `;
        break;
      case 'booking_cancelled':
        actionButton = `
          <div style="text-align: center; margin: 30px 0;">
            <p style="color: #dc2626; margin-bottom: 20px;">We're sorry your booking was cancelled.</p>
            <a href="https://cranbourne-public-hall.vercel.app/booknow" 
               style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Book Again
            </a>
          </div>
        `;
        break;
      case 'booking_price_updated':
        actionButton = `
          <div style="text-align: center; margin: 30px 0;">
            <p style="color: #d97706; margin-bottom: 20px;">Please review the updated pricing.</p>
            <a href="https://cranbourne-public-hall.vercel.app/booknow" 
               style="background-color: #d97706; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              View Updated Price
            </a>
          </div>
        `;
        break;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cranbourne Public Hall - ${title}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f1f5f9;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 20px; text-align: center;">
            <img src="${logoUrl}" alt="Cranbourne Public Hall" style="max-width: 200px; height: auto;">
            <h1 style="color: white; margin: 20px 0 0 0; font-size: 24px; font-weight: 600;">Cranbourne Public Hall</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 30px;">
            <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 28px; font-weight: 700;">${title}</h2>
            
            <div style="color: #475569; line-height: 1.6; font-size: 16px; margin-bottom: 20px;">
              ${message}
            </div>
            
            ${bookingDetails}
            ${actionButton}
            
            <div style="border-top: 1px solid #e2e8f0; margin-top: 40px; padding-top: 30px; text-align: center;">
              <p style="color: #64748b; font-size: 14px; margin: 0 0 10px 0;">
                Thank you for choosing Cranbourne Public Hall!
              </p>
              <p style="color: #64748b; font-size: 14px; margin: 0;">
                If you have any questions, please don't hesitate to contact us.
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 10px 0;">
              Cranbourne Public Hall Management System
            </p>
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              This is an automated notification. Please do not reply to this email.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendCustomizedEmail(emailData) {
    try {
      const { to, subject, body, recipientName, bookingId, templateName, isCustom } = emailData;
      
      // Generate email content with enhanced template
      const emailContent = this.generateCustomizedEmailContent({
        subject,
        body,
        recipientName,
        bookingId,
        templateName,
        isCustom
      });
      
      const mailOptions = {
        from: 'pawankanchana34741@gmail.com',
        to: to,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Customized email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ Failed to send customized email:', error);
      throw error;
    }
  }

  generateCustomizedEmailContent({ subject, body, recipientName, bookingId, templateName, isCustom }) {
    const logoUrl = 'https://via.placeholder.com/200x80/4F46E5/FFFFFF?text=Cranbourne+Hall';
    
    // Create a more flexible template for customized emails
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cranbourne Public Hall - ${subject}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f1f5f9;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 20px; text-align: center;">
            <img src="${logoUrl}" alt="Cranbourne Public Hall" style="max-width: 200px; height: auto;">
            <h1 style="color: white; margin: 20px 0 0 0; font-size: 24px; font-weight: 600;">Cranbourne Public Hall</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 30px;">
            <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 28px; font-weight: 700;">${subject}</h2>
            
            <div style="color: #475569; line-height: 1.6; font-size: 16px; margin-bottom: 20px;">
              ${this.formatEmailBody(body)}
            </div>
            
            <div style="border-top: 1px solid #e2e8f0; margin-top: 40px; padding-top: 30px; text-align: center;">
              <p style="color: #64748b; font-size: 14px; margin: 0 0 10px 0;">
                Thank you for choosing Cranbourne Public Hall!
              </p>
              <p style="color: #64748b; font-size: 14px; margin: 0;">
                If you have any questions, please don't hesitate to contact us.
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 10px 0;">
              Cranbourne Public Hall Management System
            </p>
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              ${isCustom ? 'This is a custom message from our team.' : `Template: ${templateName || 'Custom'}`}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      subject: `Cranbourne Public Hall - ${subject}`,
      text: body,
      html: htmlContent
    };
  }

  formatEmailBody(body) {
    if (!body) return '';
    
    // Convert line breaks to HTML
    return body
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }

  async sendTestEmail(toEmail) {
    try {
      const testNotification = {
        type: 'booking_confirmed',
        title: 'Test Notification',
        message: 'This is a test email to verify the email notification system is working correctly.',
        data: {
          bookingId: 'TEST-123',
          eventType: 'Test Event',
          bookingDate: new Date().toLocaleDateString(),
          startTime: '10:00 AM',
          endTime: '2:00 PM',
          calculatedPrice: 150.00
        }
      };

      const result = await this.sendNotificationEmail(testNotification, toEmail);
      console.log('✅ Test email sent successfully to:', toEmail);
      return result;
    } catch (error) {
      console.error('❌ Test email failed:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();
