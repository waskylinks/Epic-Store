// emailTest.js
import dotenv from 'dotenv';
dotenv.config();

import { testEmail } from './utils/sendEmail.js'; // adjust path if needed

testEmail()
  .then(() => {
    console.log('✅ Test email sent successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Test email failed:', err);
    process.exit(1);
  });
