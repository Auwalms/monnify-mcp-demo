import { Router } from "express";
import crypto from "node:crypto";
import db, { getUser } from "../db/db.js";
import * as monnify from "../services/monnify.js";

const router = Router();

router.post("/auth/login", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ error: "Email is required" });
  }

  await db.read();
  const user = db.data.users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
  if (!user) {
    return res.status(401).json({ error: "Email not found" });
  }

  res.json({
    userId: user.userId,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
  });
});

router.get("/auth/emails", async (req, res) => {
  await db.read();
  const emails = db.data.users.map((u) => ({
    email: u.email,
    name: `${u.firstName} ${u.lastName}`,
  }));
  res.json({ emails });
});

router.get("/user", async (req, res) => {
  await db.read();
  const userId = req.query.userId || "usr_001";
  const user = getUser(userId);
  if (!user) {
    return res.status(404).json({ error: `User ${userId} not found` });
  }
  res.json(user);
});

router.get("/users", async (req, res) => {
  await db.read();
  const users = db.data.users.map((u) => ({
    userId: u.userId,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    kycStatus: u.kycStatus,
    accountStatus: u.accountStatus,
    wallet: { balance: u.wallet.balance },
  }));
  res.json({ users });
});

router.get("/banks", async (req, res) => {
  try {
    const banks = await monnify.getBankList();
    res.json({ banks });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post("/wallet/resolve-account", async (req, res) => {
  const { bankCode, accountNumber } = req.body;
  if (!bankCode || !accountNumber) {
    return res
      .status(400)
      .json({ error: "bankCode and accountNumber are required" });
  }

  try {
    const { accountName } = await monnify.resolveAccountName(
      bankCode,
      accountNumber
    );
    res.json({ accountName });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post("/wallet/checkout", async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Amount must be greater than 0" });
  }

  await db.read();
  const user = getUser();

  try {
    const result = await monnify.initiateCheckout({
      amount,
      currencyCode: "NGN",
      customerEmail: user.email,
      customerName: `${user.firstName} ${user.lastName}`,
      paymentReference: `pensionpal-${crypto.randomUUID()}`,
      paymentDescription: "PensionPal wallet funding",
    });
    res.json({
      checkoutUrl: result.checkoutUrl,
      paymentReference: result.paymentReference,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get("/wallet/checkout/callback", async (req, res) => {
  const paymentReference = req.query.paymentReference;
  if (!paymentReference) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Payment Error</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>Payment Error</h1>
          <p>Payment reference is missing. Please contact support.</p>
          <button onclick="window.close()">Close</button>
        </body>
      </html>
    `);
  }

  await db.read();

  try {
    const transaction = await monnify.getTransactionStatus(paymentReference);

    if (transaction.paymentStatus === "PAID") {
      if (!db.data.processedTransactions) db.data.processedTransactions = [];

      const customerEmail = transaction.customerEmail;
      const user = customerEmail
        ? db.data.users.find(u => u.email.toLowerCase() === customerEmail.toLowerCase())
        : getUser();

      if (!user) {
        throw new Error(`Could not find user for email: ${customerEmail}`);
      }

      if (db.data.processedTransactions.includes(paymentReference)) {
        return res.send(`
          <!DOCTYPE html>
          <html>
            <head><title>Payment Already Processed</title></head>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1>Payment Already Processed</h1>
              <p>This payment has already been applied to your wallet.</p>
              <p style="color: #666; font-size: 0.9em;">This window will close in 3 seconds...</p>
              <script>setTimeout(() => window.close(), 3000);</script>
            </body>
          </html>
        `);
      }

      user.wallet.balance += transaction.amount;
      db.data.processedTransactions.push(paymentReference);
      user.events.push({
        timestamp: new Date().toISOString(),
        message: `Wallet funded: ₦${transaction.amount.toLocaleString()} via checkout`,
      });
      await db.write();

      return res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Payment Successful</title>
            <style>
              body { font-family: sans-serif; padding: 40px; text-align: center; }
              .success { color: #10b981; }
            </style>
          </head>
          <body>
            <h1 class="success">✓ Payment Successful</h1>
            <p>Your wallet has been funded with ₦${transaction.amount.toLocaleString()}</p>
            <p>New balance: ₦${user.wallet.balance.toLocaleString()}</p>
            <p style="color: #666; font-size: 0.9em;">This window will close in 3 seconds...</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
    } else if (transaction.paymentStatus === "PENDING") {
      return res.send(`
        <!DOCTYPE html>
        <html>
          <head><title>Payment Pending</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>Payment Pending</h1>
            <p>Your payment is being processed. Please check your main window shortly.</p>
            <button onclick="window.close()">Close</button>
          </body>
        </html>
      `);
    } else {
      return res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Payment ${transaction.paymentStatus}</title>
            <style>body { font-family: sans-serif; padding: 40px; text-align: center; color: #dc2626; }</style>
          </head>
          <body>
            <h1>Payment ${transaction.paymentStatus}</h1>
            <p>Your payment could not be processed.</p>
            <button onclick="window.close()">Close</button>
          </body>
        </html>
      `);
    }
  } catch (err) {
    console.error('Checkout callback error:', err);
    res.status(502).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Error</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center; color: #dc2626;">
          <h1>Error Checking Payment Status</h1>
          <p>${err.message}</p>
          <p style="font-size: 0.9em; color: #666;">Payment ref: ${paymentReference}</p>
          <p style="font-size: 0.9em; color: #666;">Please refresh your main window or contact support.</p>
          <button onclick="window.close()">Close</button>
        </body>
      </html>
    `);
  }
});

router.post("/wallet/mandate", async (req, res) => {
  const { bankCode, accountNumber, accountName, amount, frequency } = req.body;
  if (!bankCode || !accountNumber || !accountName || !amount || !frequency) {
    return res.status(400).json({
      error:
        "bankCode, accountNumber, accountName, amount, and frequency are required",
    });
  }

  await db.read();
  const user = getUser();
  user.directDebit.payer = { bankCode, accountNumber, accountName };

  const result = await monnify.createMandate({
    userEmail: user.email,
    bankCode,
    accountNumber,
    accountName,
    amount,
    frequency,
  });

  if (!result.implemented) {
    user.directDebit.mandate = {
      mandateReference: `MOCK-${crypto.randomUUID()}`,
      mandateCode: result.mandateId,
      status: "INITIATED",
      amount,
      frequency,
      createdAt: new Date().toISOString(),
    };
    await db.write();
  }

  res.json(result);
});

router.get("/wallet/mandate/:mandateId/status", async (req, res) => {
  const result = await monnify.checkMandateStatus(req.params.mandateId);
  res.json(result);
});

router.post("/wallet/mandate/:mandateId/authorise", async (req, res) => {
  const result = await monnify.authoriseMandate(req.params.mandateId, req.body);
  res.json(result);
});

// Admin endpoints
router.get("/admin/mandates", async (req, res) => {
  await db.read();
  const mandates = db.data.users
    .filter((u) => u.directDebit.mandate && u.directDebit.mandate.status)
    .map((u) => ({
      userId: u.userId,
      userName: `${u.firstName} ${u.lastName}`,
      email: u.email,
      mandate: u.directDebit.mandate,
      payer: u.directDebit.payer,
    }));
  res.json({ mandates });
});

router.post("/admin/mandate/:userId/debit", async (req, res) => {
  const adminPassword = req.headers["x-admin-password"];
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await db.read();
  const user = db.data.users.find((u) => u.userId === req.params.userId);

  if (!user) {
    return res
      .status(404)
      .json({ error: `User ${req.params.userId} not found` });
  }

  const mandate = user.directDebit.mandate;
  if (!mandate || mandate.status !== "ACTIVE") {
    return res
      .status(400)
      .json({ error: "User does not have an active mandate" });
  }

  const today = new Date().toDateString();
  if (mandate.lastDebitDate === today) {
    return res
      .status(400)
      .json({ error: "Mandate has already been debitted today" });
  }

  try {
    const paymentRef = `debit-${crypto.randomUUID()}`;
    const result = await monnify.debitMandate({
      paymentReference: paymentRef,
      mandateCode: mandate.mandateCode,
      debitAmount: mandate.amount,
      narration: `Monthly pension contribution - ${new Date().toLocaleDateString()}`,
      customerEmail: user.email,
    });

    mandate.lastDebitDate = today;
    mandate.debitHistory.push({
      date: new Date().toISOString(),
      amount: mandate.amount,
      paymentReference: paymentRef,
      status: "COMPLETED",
    });

    user.wallet.balance += mandate.amount;
    user.events.push({
      timestamp: new Date().toISOString(),
      message: `Monthly mandate debit: ₦${mandate.amount.toLocaleString()}`,
    });

    await db.write();
    res.json({
      success: true,
      message: `Debitted ₦${mandate.amount} from ${user.firstName}`,
      result,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
