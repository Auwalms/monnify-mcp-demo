import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSONFilePreset } from 'lowdb/node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(__dirname, 'db.json');

const defaultData = {
  processedTransactions: [],
  users: [
    {
      userId: 'usr_001',
      firstName: 'Amina',
      lastName: 'Bello',
      email: 'amina.bello@email.com',
      phoneNumber: '+2348012345678',
      createdAt: '2024-01-15T10:30:00Z',
      kycStatus: 'VERIFIED',
      accountStatus: 'ACTIVE',
      wallet: {
        balance: 0,
        currency: 'NGN',
      },
      directDebit: {
        payer: null,
        mandate: null,
      },
      events: [],
    },
    {
      userId: 'usr_002',
      firstName: 'Chioma',
      lastName: 'Okafor',
      email: 'chioma.okafor@email.com',
      phoneNumber: '+2349087654321',
      createdAt: '2024-02-20T14:45:00Z',
      kycStatus: 'VERIFIED',
      accountStatus: 'ACTIVE',
      wallet: {
        balance: 125000,
        currency: 'NGN',
      },
      directDebit: {
        payer: {
          bankCode: '044',
          accountNumber: '2345678901',
          accountName: 'Chioma Okafor',
        },
        mandate: {
          mandateReference: 'MNFY|DD|20240220|001',
          mandateCode: 'MTDD|01HY8W3FBKHTFBZP9DQ9KNHR1G',
          status: 'ACTIVE',
          amount: 10000,
          frequency: 'MONTHLY',
          createdAt: '2024-02-20T14:45:00Z',
          lastDebitDate: null,
          debitHistory: [],
        },
      },
      events: [],
    },
    {
      userId: 'usr_003',
      firstName: 'Tunde',
      lastName: 'Akinola',
      email: 'tunde.akinola@email.com',
      phoneNumber: '+2347012345678',
      createdAt: '2023-11-05T09:15:00Z',
      kycStatus: 'PENDING',
      accountStatus: 'ACTIVE',
      wallet: {
        balance: 50000,
        currency: 'NGN',
        reservedAccount: null,
      },
      directDebit: {
        payer: null,
        mandate: null,
      },
      events: [],
    },
  ],
};

const db = await JSONFilePreset(dbFile, defaultData);

export function getUser(userId = 'usr_001') {
  return db.data.users.find((u) => u.userId === userId) || db.data.users[0];
}

export default db;
