import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// Uproszczona autoryzacja tylko jednego konta Allegro
// Po zalogowaniu token trafia do req.session.allegroToken

const router = express.Router();

const {
  ALLEGRO_CLIENT_ID,
  ALLEGRO_CLIENT_SECRET,
  ALLEGRO_API_URL_AUTH
} = process.env;

const REDIRECT_URI = 'http://localhost:3001/auth/callback';
// Zakres pozostaje szeroki – można zawęzić w razie potrzeby
const SCOPE = "allegro:api:sale:offers:read allegro:api:sale:offers:write allegro:api:sale:settings:read allegro:api:sale:settings:write allegro:api:ads allegro:api:campaigns allegro:api:orders:read allegro:api:orders:write allegro:api:ratings allegro:api:disputes allegro:api:billing:read allegro:api:payments:read allegro:api:payments:write allegro:api:profile:read allegro:api:profile:write allegro:api:bids allegro:api:messaging allegro:api:fulfillment:read allegro:api:fulfillment:write allegro:api:shipments:read allegro:api:shipments:write allegro:api:affiliate:read allegro:api:affiliate:write";

router.get('/login', (_req, res) => {
  const state = Buffer.from(JSON.stringify({ t: Date.now() })).toString('base64url');
  const url = `https://allegro.pl/auth/oauth/authorize?response_type=code&client_id=${ALLEGRO_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPE}&state=${state}`;
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Brak kodu autoryzacyjnego');
  try {
    const auth = Buffer.from(`${ALLEGRO_CLIENT_ID}:${ALLEGRO_CLIENT_SECRET}`).toString('base64');
    const response = await axios.post(
      ALLEGRO_API_URL_AUTH,
      `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
      { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    req.session = req.session || {};
    req.session.allegroToken = response.data;
    res.redirect('http://localhost:5173');
  } catch (e) {
    res.status(500).json({ error: e.message, details: e?.response?.data });
  }
});

export default router;
