import { Router } from 'express';
import crypto from 'node:crypto';
import db from '../db/db.js';

const router = Router();
const SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const BASE_URL = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
const IS_SANDBOX = BASE_URL.includes('sandbox');

function logEventToUser(user, type, message, extra = {}) {
  user.events.unshift({
    id: crypto.randomUUID(),
    type,
    message,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

// Monnify's own docs describe this as SHA-512(secretKey + body), but their published
// sample code actually computes HMAC-SHA512(secretKey, body) — trusting the code sample here.
function isSignatureValid(req) {
  const header = req.headers['monnify-signature'];
  if (!SECRET_KEY || !req.rawBody || !header) return null;
  const computed = crypto.createHmac('sha512', SECRET_KEY).update(req.rawBody).digest('hex');
  return computed === header;
}

router.post('/monnify', async (req, res) => {
  await db.read();

  if (!db.data.processedTransactions) db.data.processedTransactions = [];

  const { eventType, eventData } = req.body || {};

  const customerEmail = eventData?.customerEmail;
  const user = customerEmail
    ? db.data.users.find(u => u.email.toLowerCase() === customerEmail.toLowerCase())
    : null;

  if (!IS_SANDBOX && isSignatureValid(req) === false && user) {
    logEventToUser(user, 'WEBHOOK_SIGNATURE_MISMATCH', 'Received a webhook with a signature that failed verification — processed anyway for demo reliability.');
  }

  if (eventType === 'SUCCESSFUL_TRANSACTION') {
    const transactionRef = eventData?.paymentReference;
    const amountPaid = eventData?.amountPaid || 0;
    const isReservedAccountFunding = eventData?.product?.type === 'RESERVED_ACCOUNT';

    if (!user) {
      return res.status(400).json({ error: 'Could not find user for this transaction' });
    }

    if (!transactionRef || db.data.processedTransactions.includes(transactionRef)) {
      logEventToUser(user, 'DUPLICATE_TRANSACTION', `Webhook for transaction ${transactionRef} was already processed — ignoring to prevent double-credit.`);
    } else {
      user.wallet.balance += amountPaid;
      db.data.processedTransactions.push(transactionRef);
      logEventToUser(
        user,
        isReservedAccountFunding ? 'RESERVED_ACCOUNT_FUNDED' : 'CHECKOUT_COMPLETED',
        `NGN wallet credited ₦${amountPaid} via ${isReservedAccountFunding ? 'reserved account' : 'checkout link'}.`,
        { amount: amountPaid },
      );
    }
  } else if (eventType === 'MANDATE_UPDATE') {
    // Stub — built live in workshop, alongside the create/check-status/authorise mandate build.
    if (user) {
      logEventToUser(user, 'MANDATE_UPDATE_RECEIVED', 'Received a mandate update webhook (handling not yet implemented).', {
        raw: eventData,
      });
    }
  } else if (user) {
    logEventToUser(user, 'UNHANDLED_WEBHOOK', `Received unhandled webhook event type: ${eventType}`);
  }

  await db.write();
  res.status(200).json({ received: true });
});

export default router;
