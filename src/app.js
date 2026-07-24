import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import walletRouter from './routes/wallet.js';
import webhooksRouter from './routes/webhooks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }),
);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', walletRouter);
app.use('/api/webhooks', webhooksRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PensionPal listening on http://localhost:${PORT}`);
});
