import crypto from "node:crypto";

const BASE_URL = process.env.MONNIFY_BASE_URL || "https://sandbox.monnify.com";
const API_KEY = process.env.MONNIFY_API_KEY;
const SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE;
const SUBACCOUNT_CODE = process.env.MONNIFY_SUBACCOUNT_CODE;
const SUBACCOUNT_SPLIT_PERCENTAGE =
  Number(process.env.MONNIFY_SUBACCOUNT_SPLIT_PERCENTAGE) || 10;
const REDIRECT_URL =
  process.env.CHECKOUT_REDIRECT_URL || "http://localhost:3000";

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const basicAuth = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString("base64");
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}` },
  });
  const data = await res.json();

  if (!data.requestSuccessful) {
    throw new Error(data.responseMessage || "Monnify authentication failed");
  }

  cachedToken = data.responseBody.accessToken;
  tokenExpiresAt = Date.now() + (data.responseBody.expiresIn - 30) * 1000;
  return cachedToken;
}

async function monnifyFetch(path, { method = "GET", body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();

  if (!data.requestSuccessful) {
    throw new Error(
      data.responseMessage || `Monnify request to ${path} failed`
    );
  }

  return data.responseBody;
}

/**
 * Splits a percentage of fees to the configured provider subaccount. Server cost must be paid. Lol!
 * Returns undefined (omitting incomeSplitConfig entirely) when no subaccount is configured.
 */
function buildIncomeSplitConfig() {
  if (!SUBACCOUNT_CODE) return undefined;

  return [
    {
      subAccountCode: SUBACCOUNT_CODE,
      feePercentage: 100,
      splitPercentage: SUBACCOUNT_SPLIT_PERCENTAGE,
      feeBearer: false,
    },
  ];
}

export async function getBankList() {
  return monnifyFetch("/api/v1/banks");
}

export async function resolveAccountName(bankCode, accountNumber) {
  const query = new URLSearchParams({ accountNumber, bankCode });
  return monnifyFetch(`/api/v2/disbursements/account/validate?${query}`);
}

export async function initiateCheckout({
  amount,
  currencyCode,
  customerEmail,
  customerName,
  paymentReference,
  paymentDescription,
}) {
  return monnifyFetch("/api/v1/merchant/transactions/init-transaction", {
    method: "POST",
    body: {
      amount,
      currencyCode,
      customerEmail,
      customerName,
      paymentReference,
      paymentDescription,
      contractCode: CONTRACT_CODE,
      redirectUrl: `${REDIRECT_URL}/api/wallet/checkout/callback`,
      paymentMethods: ["CARD", "ACCOUNT_TRANSFER", "USSD"],
      incomeSplitConfig: buildIncomeSplitConfig(),
    },
  });
}

export async function getTransactionStatus(paymentReference) {
  const token = await getAccessToken();
  const url = `${BASE_URL}/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(paymentReference)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json();

  if (!data.requestSuccessful) {
    console.error("Monnify transaction query failed:", {
      url,
      status: res.status,
      response: data,
    });
    throw new Error(
      data.responseMessage || `Failed to query transaction ${paymentReference}`
    );
  }

  // Monnify returns responseBody as an object with transaction details
  const transaction = data.responseBody;

  if (!transaction || !transaction.paymentReference) {
    throw new Error(`No transaction found for reference ${paymentReference}`);
  }

  return {
    paymentReference: transaction.paymentReference,
    amount: Number(transaction.amountPaid),
    paymentStatus: transaction.paymentStatus,
    paymentMethod: transaction.paymentMethod,
    paidOn: transaction.paidOn,
  };
}

// TODO: built live in workshop
export async function createMandate({
  userEmail,
  bankCode,
  accountNumber,
  accountName,
  amount,
  frequency,
}) {
  return {
    implemented: false,
    message:
      "Direct debit mandate creation is not yet implemented — this is built live in the workshop.",
    mandateId: `MOCK-${crypto.randomUUID()}`,
  };
}

// TODO: built live in workshop
export async function checkMandateStatus(mandateId) {
  return {
    implemented: false,
    message:
      "Mandate status checking is not yet implemented — this is built live in the workshop.",
    mandateId,
  };
}

// TODO: built live in workshop
export async function authoriseMandate(mandateId, { otp } = {}) {
  return {
    implemented: false,
    message:
      "Mandate authorisation is not yet implemented — this is built live in the workshop.",
    mandateId,
  };
}

export async function debitMandate({
  paymentReference,
  mandateCode,
  debitAmount,
  narration,
  customerEmail,
}) {
  return monnifyFetch("/api/v1/direct-debit/mandate/debit", {
    method: "POST",
    body: {
      paymentReference,
      mandateCode,
      debitAmount,
      narration,
      customerEmail,
    },
  });
}
