
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import session from 'express-session';
import crypto from 'crypto';
import authRouter from './allegro.js';
import wooRouter from './woo.js';
dotenv.config();

const app = express();
const PORT = 3001;
app.use(express.json());
// CORS dla frontu Vite (5173) z obsługą cookies
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === 'http://localhost:5173') {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(session({
  secret: 'allegro_secret',
  resave: false,
  saveUninitialized: true,
}));
app.use('/auth', authRouter);
app.use('/woo', wooRouter); // dwa konta WooCommerce (outdoorowe, sklepbastion)

let cachedToken = null;
let tokenExpires = 0;

// PRO: Prosty cache detali ofert, by nie pobierać ich co odświeżenie.
// TTL w ms (domyślnie 6 godzin); można nadpisać przez ENV OFFER_CACHE_TTL_MS
const OFFER_CACHE_TTL = parseInt(process.env.OFFER_CACHE_TTL_MS || '', 10) || (6 * 60 * 60 * 1000);
const ALLEGRO_REQ_TIMEOUT = parseInt(process.env.ALLEGRO_REQ_TIMEOUT_MS || '', 10) || 4000; // 4s domyślnie
const offerCache = new Map(); // id -> { name, image, source, cachedAt }

// Jedno konto – token tylko w req.session.allegroToken
function getUserAccessToken(req) {
  return req.session?.allegroToken?.access_token;
}

// Uniwersalne pobranie szczegółów oferty (nazwa + pierwszy obrazek) niezależnie od tego, czy jesteś właścicielem.
// 1. Próbuje publicznego endpointu: /offers/{id}
// 2. Fallback do prywatnego: /sale/offers/{id} (wymaga bycia sprzedawcą + scope)
async function fetchOfferDetails(ALLEGRO_API_URL, id, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.allegro.public.v1+json',
  'Accept-Language': 'pl-PL',
  };

  // Cache hit?
  const cached = offerCache.get(id);
  if (cached && (Date.now() - cached.cachedAt) < OFFER_CACHE_TTL) {
    return { name: cached.name, image: cached.image, source: cached.source || 'cache' };
  }

  const extract = (data) => {
    if (!data) return { name: 'Nieznany produkt', image: null };
    if (Array.isArray(data.offers) && data.offers.length === 1) {
      data = data.offers[0];
    }
    return {
      name: data.name || data.title || 'Nieznany produkt',
      image: data.images?.[0]?.url || data.primaryImage?.url || null,
    };
  };

  // Publiczny endpoint (nie /sale/). Zwraca title (nazwa) + images.
  try {
    const pub = await axios.get(`${ALLEGRO_API_URL}/offers/${id}`, { headers, timeout: ALLEGRO_REQ_TIMEOUT });
    const extracted = extract(pub.data);
    offerCache.set(id, { ...extracted, source: 'public', cachedAt: Date.now() });
    return { ...extracted, source: 'public' };
  } catch (e) {
    const status = e?.response?.status;
    // Jeśli to typowy brak dostępu/danych, przejdź do prywatnego endpointu.
    if (![401, 403, 404, 406].includes(status)) {
      console.warn(`Public /offers/${id} inny błąd ${status}`);
    }
    // Dodatkowy fallback na 406: spróbuj beta i bez Accept
    if (status === 406) {
      try {
        const alt = await axios.get(`${ALLEGRO_API_URL}/offers/${id}`, { headers: { ...headers, Accept: 'application/vnd.allegro.beta.v1+json' }, timeout: ALLEGRO_REQ_TIMEOUT });
        const extracted = extract(alt.data);
        offerCache.set(id, { ...extracted, source: 'public-beta', cachedAt: Date.now() });
        return { ...extracted, source: 'public-beta' };
      } catch {}
      try {
        const alt2 = await axios.get(`${ALLEGRO_API_URL}/offers/${id}`, { headers: { Authorization: headers.Authorization, 'Accept-Language': headers['Accept-Language'] }, timeout: ALLEGRO_REQ_TIMEOUT });
        const extracted = extract(alt2.data);
        offerCache.set(id, { ...extracted, source: 'public-noaccept', cachedAt: Date.now() });
        return { ...extracted, source: 'public-noaccept' };
      } catch {}
    }
  }

  // Prywatny endpoint (dla własnych ofert) – jeśli nie jesteś właścicielem -> 404 / 403
  try {
    const priv = await axios.get(`${ALLEGRO_API_URL}/sale/offers/${id}`, { headers, timeout: ALLEGRO_REQ_TIMEOUT });
  const extracted = extract(priv.data);
  offerCache.set(id, { ...extracted, source: 'private', cachedAt: Date.now() });
  return { ...extracted, source: 'private' };
  } catch (e2) {
    // Celowo wyciszamy typowe 401/403/404 dla prywatnych endpointów – oznaczają brak własności/oferty.
    // Nietypowe statusy też pomijamy aby nie zaśmiecać logów (można włączyć przez VERBOSE_LOGS=1).
    const st = e2?.response?.status;
    if (process.env.VERBOSE_LOGS === '1' && ![401,403,404].includes(st)) {
      console.warn(`Prywatna /sale/offers/${id} nietypowy błąd ${st}`);
    }
  }
  // Ostatnia próba: stary filtr (często zwraca pojedynczy wpis w offers)
  try {
    const list = await axios.get(`${ALLEGRO_API_URL}/sale/offers?offer.id=${id}`, { headers, timeout: ALLEGRO_REQ_TIMEOUT });
    const extracted = extract(list.data);
    offerCache.set(id, { ...extracted, source: 'filter', cachedAt: Date.now() });
    return { ...extracted, source: 'filter' };
  } catch (e3) {
    const st = e3?.response?.status;
    if (process.env.VERBOSE_LOGS === '1' && ![404,406].includes(st)) console.warn(`Filtr /sale/offers?offer.id=${id} błąd ${st}`);
  }

  return { name: 'Nieznany produkt', image: null, source: 'none' };
}

// Pobierz login sprzedawcy (właściciela tokenu) z dedykowanego endpointu /me
async function fetchSellerLogin(ALLEGRO_API_URL, token) {
  try {
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json' };
    const resp = await axios.get(`${ALLEGRO_API_URL}/me`, { headers });
    return resp.data?.login || 'unknown';
  } catch {
    return 'unknown';
  }
}

app.get('/api/orders', async (req, res) => {
  try {
  const reqId = Math.random().toString(36).slice(2,7);
  console.time(`[ORD ${reqId}] total`);
    const token = getUserAccessToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Brak autoryzacji użytkownika. Zaloguj się przez /auth/login.' });
    }

    const { ALLEGRO_API_URL } = process.env;
    const now = new Date();
    const to = now.toISOString();
    const allowed = [1,2,3,4,5,7,10,14];
    let days = parseInt(req.query.days, 10);
    if (!allowed.includes(days)) days = 7;
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  // Uwaga: brak oficjalnego _fields dla checkout-forms; pozostawiamy pełne dane.
  const url = `${ALLEGRO_API_URL}/order/checkout-forms?lineItems.boughtAt.gte=${from}&lineItems.boughtAt.lte=${to}&limit=100&offset=0`;
    console.time(`[ORD ${reqId}] checkout-forms`);
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
      },
    });
    console.timeEnd(`[ORD ${reqId}] checkout-forms`);

    const orders = response.data.checkoutForms || [];
    console.log(`[ORD ${reqId}] checkout-forms count=${orders.length}`);

    // Zbieramy wszystkie unikalne ID ofert
    const offerIds = [
      ...new Set(
        orders.flatMap((o) =>
          (o.lineItems || []).map((li) => li.offer?.id).filter(Boolean)
        )
      ),
    ];

    // Pobieramy szczegóły ofert z ograniczoną współbieżnością i cachem
    const offerDetails = {};
    const chunkSize = 20; // ogranicz jednoczesne żądania
    console.log(`[ORD ${reqId}] unique offerIds=${offerIds.length}, chunkSize=${chunkSize}`);
    console.time(`[ORD ${reqId}] offer-details total`);
    for (let i = 0; i < offerIds.length; i += chunkSize) {
      const chunk = offerIds.slice(i, i + chunkSize);
      const cStart = Date.now();
      const results = await Promise.all(chunk.map(async (id) => {
        try { return [id, await fetchOfferDetails(ALLEGRO_API_URL, id, token)]; }
        catch { return [id, { name: 'Nieznany produkt', image: null }]; }
      }));
      results.forEach(([id, det]) => { offerDetails[id] = det; });
      const cMs = Date.now() - cStart;
      console.log(`[ORD ${reqId}] offer-chunk ${i}-${i+chunk.length-1} size=${chunk.length} took=${cMs}ms`);
    }
    console.timeEnd(`[ORD ${reqId}] offer-details total`);

  // Wzbogacamy zamówienia o zdjęcia + ewentualny lokalny fallback notatek _localNote
    const enrichedOrders = orders.map((order) => ({
      ...order,
      lineItems: (order.lineItems || []).map((li) => {
        const det = li.offer?.id ? offerDetails[li.offer.id] : null;
        const detName = det?.name;
        const detImg = det?.image;
        const name = (detName && detName !== 'Nieznany produkt') ? detName : (li.offer?.name || li.offer?.title || 'Produkt');
        const image = detImg || li.offer?.image || null;
        return {
          ...li,
          offer: { ...li.offer, name, image },
        };
      }),
    }));

    // Nie nadpisujemy enrichedOrders później, więc możemy zwrócić bez dodatkowej pętli

  console.timeEnd(`[ORD ${reqId}] total`);
  res.json({ checkoutForms: enrichedOrders });

  } catch (e) {
    console.error('Błąd Allegro API:', {
      status: e?.response?.status,
      statusText: e?.response?.statusText,
      data: e?.response?.data,
      headers: e?.response?.headers,
      requestHeaders: e?.config?.headers,
    });
    res.status(500).json({
      error: e.message,
      details: e?.response?.data,
      status: e?.response?.status,
    });
  }
});

// Zwróć login sprzedawcy (dla frontendu – pojedyncze konto per sesja)
app.get('/api/seller', async (req, res) => {
  try {
    const token = getUserAccessToken(req);
    if (!token) return res.status(401).json({ error: 'Brak autoryzacji.' });
    const { ALLEGRO_API_URL } = process.env;
    const login = await fetchSellerLogin(ALLEGRO_API_URL, token);
    res.json({ login });
  } catch (e) {
    res.status(500).json({ error: 'Nie udało się pobrać loginu sprzedawcy' });
  }
});

// Lista zwrotów klienckich (minimalna) – używana do wizualnego oznaczania pozycji
app.get('/api/returns', async (req, res) => {
  try {
  const reqId = Math.random().toString(36).slice(2,7);
  console.time(`[RET ${reqId}] total`);
    const token = getUserAccessToken(req);
    if (!token) return res.status(401).json({ error: 'Brak autoryzacji.' });
    const { ALLEGRO_API_URL } = process.env;
    const headersBase = { Authorization: `Bearer ${token}`, 'Accept-Language': 'pl-PL' };
  const days = parseInt(req.query.days, 10);
  const gteParam = req.query.gte ? String(req.query.gte) : null;
  const lteParam = req.query.lte ? String(req.query.lte) : null;
  const statusParam = req.query.status ? String(req.query.status) : null;
  const orderIdParam = req.query.orderId ? String(req.query.orderId) : null;
    // Preferuj beta Accept zgodnie z dokumentacją; z fallbackami
    async function fetchReturns(fullUrl) {
      try {
        const url = fullUrl || `${ALLEGRO_API_URL}/order/customer-returns`;
        if (process.env.VERBOSE_LOGS === '1') console.log('[returns] GET', url);
        return await axios.get(url, { headers: { ...headersBase, Accept: 'application/vnd.allegro.beta.v1+json' } });
      } catch (e) {
        const st = e?.response?.status;
        if (st === 406 || st === 415) {
          try { return await axios.get(fullUrl || `${ALLEGRO_API_URL}/order/customer-returns`, { headers: { ...headersBase, Accept: 'application/vnd.allegro.public.v1+json' } }); } catch {}
          try { return await axios.get(fullUrl || `${ALLEGRO_API_URL}/order/customer-returns`, { headers: headersBase }); } catch {}
        }
        throw e;
      }
    }
    // Zbuduj URL z filtrami (preferujemy createdAt.gte/lte, limit=1000)
    const nowIso = new Date().toISOString();
    let gteIso = gteParam;
    let lteIso = lteParam || nowIso;
    if (!gteIso && Number.isFinite(days) && days > 0) {
      const fromTs = Date.now() - days * 24 * 60 * 60 * 1000;
      gteIso = new Date(fromTs).toISOString();
    }
    const qs = new URLSearchParams();
    qs.set('limit', '1000');
    qs.set('offset', '0');
    if (gteIso) qs.set('createdAt.gte', gteIso);
    if (lteIso) qs.set('createdAt.lte', lteIso);
    if (statusParam) qs.set('status', statusParam);
    if (orderIdParam) qs.set('orderId', orderIdParam);

    // Pobierz zwroty z filtrami czasu
  console.time(`[RET ${reqId}] fetch`);
  const r = await fetchReturns(`${ALLEGRO_API_URL}/order/customer-returns?${qs.toString()}`);
  console.timeEnd(`[RET ${reqId}] fetch`);
    const arr = Array.isArray(r.data?.customerReturns) ? r.data.customerReturns : [];
  console.log(`[RET ${reqId}] returns count=${arr.length}`);
    // Mapowanie do uproszczonej struktury
    let simplified = arr.map(cr => ({
      id: cr.id,
      orderId: cr.orderId,
      createdAt: cr.createdAt,
      status: cr.status,
      referenceNumber: cr.referenceNumber || cr.refNumber || null, // numer zwrotu wymagany na froncie
      itemsOfferIds: Array.isArray(cr.items) ? cr.items.map(it => it?.offerId).filter(Boolean) : []
    }));
    // Sortowanie malejąco po dacie
    simplified.sort((a, b) => {
      const ta = Date.parse(a.createdAt);
      const tb = Date.parse(b.createdAt);
      return (Number.isFinite(tb) ? tb : -Infinity) - (Number.isFinite(ta) ? ta : -Infinity);
    });
  console.timeEnd(`[RET ${reqId}] total`);
  res.json({ returns: simplified, count: simplified.length });
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: 'Nie udało się pobrać zwrotów', details: e?.response?.data, message: e.message });
  }
});

// Endpoint debug: pełne surowe dane oferty (public/private/filter) dla diagnostyki modelu
app.get('/api/offer/:id/debug', async (req, res) => {
  try {
    const token = getUserAccessToken(req);
    if (!token) return res.status(401).json({ error: 'Brak autoryzacji.' });
    const { id } = req.params;
    const { ALLEGRO_API_URL } = process.env;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.allegro.public.v1+json',
      'Accept-Language': 'pl-PL'
    };

    const result = { id, public: null, private: null, filter: null };

    // Helper do pojedynczej próby
    const tryFetch = async (label, fn) => {
      try {
        const resp = await fn();
        result[label] = { status: resp.status, data: resp.data };
      } catch (e) {
        result[label] = { status: e?.response?.status || null, error: e?.message, data: e?.response?.data };
      }
    };

    await tryFetch('public', () => axios.get(`${ALLEGRO_API_URL}/offers/${id}`, { headers }));
    await tryFetch('private', () => axios.get(`${ALLEGRO_API_URL}/sale/offers/${id}`, { headers }));
    await tryFetch('filter', () => axios.get(`${ALLEGRO_API_URL}/sale/offers?offer.id=${id}`, { headers }));

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Debug offer fail', details: e.message });
  }
});

// Surowy publiczny JSON oferty (bez filtrów) – zwraca status i body nawet przy błędach
app.get('/api/offer/:id/raw', async (req, res) => {
  const token = getUserAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Brak autoryzacji.' });
  const { id } = req.params;
  const { ALLEGRO_API_URL } = process.env;
  try {
    const r = await axios.get(`${ALLEGRO_API_URL}/offers/${id}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json', 'Accept-Language':'pl-PL' }
    });
    res.json({ status: r.status, data: r.data });
  } catch (e) {
    res.json({ status: e?.response?.status || null, error: e?.message, data: e?.response?.data });
  }
});

// Parametry oferty – próba pobrania z /sale/offers/{id} i /sale/product-offers/{id}
app.get('/api/offer/:id/params', async (req, res) => {
  const token = getUserAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Brak autoryzacji.' });
  const { id } = req.params;
  const full = req.query.full === '1' || req.query.full === 'true';
  const { ALLEGRO_API_URL } = process.env;
  const baseHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json', 'Accept-Language':'pl-PL' };
  const out = {
    offerId: id,
    saleOffer: null,
    productOffer: null,
    productSetProductParameters: [],
    combinedParameters: [],
    sources: { sale: 0, product: 0, productSetProducts: 0 },
    rawSaleOffer: undefined,
    rawProductOffer: undefined
  };
  const uniq = new Map();
  const pushParams = (arr, sourceLabel) => {
    if (!Array.isArray(arr)) return;
    arr.forEach(p => {
      const key = (p?.id || p?.name || JSON.stringify(p)) + '|' + (p?.valuesIds ? p.valuesIds.join(',') : '') + '|' + (p?.values ? p.values.join(',') : '');
      if (!uniq.has(key)) uniq.set(key, { ...p, _source: sourceLabel });
    });
  };
  // Helper z fallbackiem Accept jeżeli 406 / 415
  async function fetchWithFallback(url) {
    try { return await axios.get(url, { headers: baseHeaders }); } catch (e) {
      const st = e?.response?.status;
      if ([406,415].includes(st)) {
        try { return await axios.get(url, { headers: { ...baseHeaders, Accept: 'application/vnd.allegro.beta.v1+json' } }); } catch {}
        try { return await axios.get(url, { headers: { Authorization: baseHeaders.Authorization, 'Accept-Language': baseHeaders['Accept-Language'] } }); } catch {}
      }
      throw e;
    }
  }
  // sale/offers
  try {
    const r1 = await fetchWithFallback(`${ALLEGRO_API_URL}/sale/offers/${id}`);
    out.saleOffer = { status: r1.status, parametersCount: Array.isArray(r1.data?.parameters) ? r1.data.parameters.length : 0 };
    if (full) out.rawSaleOffer = r1.data;
    pushParams(r1.data?.parameters, 'sale.offers');
    out.sources.sale = Array.isArray(r1.data?.parameters) ? r1.data.parameters.length : 0;
  } catch (e) {
    out.saleOffer = { status: e?.response?.status || null, error: e?.message };
  }
  // sale/product-offers
  try {
    const r2 = await fetchWithFallback(`${ALLEGRO_API_URL}/sale/product-offers/${id}`);
    out.productOffer = { status: r2.status, parametersCount: Array.isArray(r2.data?.parameters) ? r2.data.parameters.length : 0 };
    if (full) out.rawProductOffer = r2.data;
    pushParams(r2.data?.parameters, 'sale.product-offers');
    out.sources.product = Array.isArray(r2.data?.parameters) ? r2.data.parameters.length : 0;
    // productSet product parameters (każdy productSet entry może mieć product.parameters)
    const ps = Array.isArray(r2.data?.productSet) ? r2.data.productSet : [];
    const psParams = [];
    ps.forEach(entry => {
      if (entry?.product?.parameters) {
        psParams.push(...entry.product.parameters);
        pushParams(entry.product.parameters, 'productSet.product');
      }
    });
    out.productSetProductParameters = psParams;
    out.sources.productSetProducts = psParams.length;
  } catch (e2) {
    out.productOffer = { status: e2?.response?.status || null, error: e2?.message };
  }
  out.combinedParameters = Array.from(uniq.values());
  res.json(out);
});

// Ustawienie / podmiana product.id w productSet oferty (PATCH /sale/product-offers/{id})
app.post('/api/offer/:id/product-set', async (req, res) => {
  try {
    const token = getUserAccessToken(req, req.body?.account || req.query?.account);
    if (!token) return res.status(401).json({ error: 'Brak autoryzacji.' });
    const { id } = req.params;
    const { productId } = req.body || {};
    if (!productId) return res.status(400).json({ error: 'Brak productId w body.' });
    const { ALLEGRO_API_URL } = process.env;
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json', 'Content-Type':'application/vnd.allegro.public.v1+json' };
    const body = { productSet: [ { product: { id: productId } } ] };
    const r = await axios.patch(`${ALLEGRO_API_URL}/sale/product-offers/${id}`, body, { headers });
    res.json({ ok:true, offerId: id, productId, status: r.status, updatedAt: r.data?.updatedAt, publication: r.data?.publication?.status });
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: 'Nie udało się zaktualizować productSet', details: e?.response?.data, message: e.message });
  }
});

// Szybkie pobranie tylko parametru o id=237206 ("Model")
app.get('/api/offer/:id/model', async (req, res) => {
  const token = getUserAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Brak autoryzacji.' });
  const { id } = req.params;
  const PARAM_ID = '237206';
  const { ALLEGRO_API_URL } = process.env;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json', 'Accept-Language':'pl-PL' };
  const result = { offerId: id, parameterId: PARAM_ID, value: null, values: [], source: null };
  // Helper do ekstrakcji
  const extract = (data, sourceTag) => {
    if (!data) return false;
    const pick = (arr) => {
      if (!Array.isArray(arr)) return false;
      const found = arr.find(p => p && (p.id === PARAM_ID || p.name === 'Model'));
      if (found) {
        result.values = found.values || [];
        result.value = result.values[0] || null;
        result.source = sourceTag;
        return true;
      }
      return false;
    };
    if (pick(data.parameters)) return true;
    if (Array.isArray(data.productSet)) {
      for (const entry of data.productSet) {
        if (pick(entry?.product?.parameters)) return true;
      }
    }
    return false;
  };
  try {
    const rProd = await axios.get(`${ALLEGRO_API_URL}/sale/product-offers/${id}`, { headers });
    extract(rProd.data, 'sale.product-offers');
  } catch {}
  if (!result.value) {
    try {
      const rSale = await axios.get(`${ALLEGRO_API_URL}/sale/offers/${id}`, { headers });
      extract(rSale.data, 'sale.offers');
    } catch {}
  }
  res.json(result);
});

// Sprawdzenie czy oferta jest nasza (owned) – sukces prywatnego pobrania = owned
app.get('/api/offer/:id/owned', async (req, res) => {
  const token = getUserAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Brak autoryzacji.' });
  const { id } = req.params;
  const { ALLEGRO_API_URL } = process.env;
  try {
    const r = await axios.get(`${ALLEGRO_API_URL}/sale/offers/${id}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json', 'Accept-Language':'pl-PL' } });
    return res.json({ owned: true, status: r.status, id });
  } catch (e) {
    const st = e?.response?.status;
    if ([403,404].includes(st)) return res.json({ owned: false, status: st, id });
    return res.status(500).json({ error: 'Nie udało się sprawdzić', status: st, details: e?.message });
  }
});

// Ustaw status zamówienia (checkout form) na PROCESSING
app.post('/api/orders/:id/processing', async (req, res) => {
  try {
    const token = getUserAccessToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Brak autoryzacji użytkownika.' });
    }
    const { id } = req.params;
    const { ALLEGRO_API_URL } = process.env;
  // PUT fulfillment (zgodnie z dokumentacją Allegro)
    const url = `${ALLEGRO_API_URL}/order/checkout-forms/${id}/fulfillment`;
  await axios.put(url, { status: 'PROCESSING' }, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
        'Content-Type': 'application/vnd.allegro.public.v1+json',
      },
    });
    res.json({ id, status: 'PROCESSING' });
  } catch (e) {
    console.error('Błąd ustawiania statusu PROCESSING', e?.response?.status, e?.response?.data);
    res.status(e?.response?.status || 500).json({
      error: 'Nie udało się ustawić statusu',
      details: e?.response?.data,
    });
  }
});

// (Usunięto endpoint edycji notatek sprzedającego – API Allegro nie wspiera zapisu note)

// NOWY: pojedyncze zamówienie (szczegóły + wzbogacenie ofert)
app.get('/api/orders/:id', async (req, res) => {
  try {
    const token = getUserAccessToken(req);
    if (!token) return res.status(401).json({ error: 'Brak autoryzacji użytkownika.' });
    const { id } = req.params;
    const { ALLEGRO_API_URL } = process.env;
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json' };
    const r = await axios.get(`${ALLEGRO_API_URL}/order/checkout-forms/${id}`, { headers });
    const order = r.data;
    if (!order || !order.id) return res.status(404).json({ error: 'Nie znaleziono zamówienia' });
    const offerIds = [
      ...new Set((order.lineItems || []).map(li => li.offer?.id).filter(Boolean))
    ];
    const offerDetails = {};
    await Promise.all(offerIds.map(async oid => { offerDetails[oid] = await fetchOfferDetails(ALLEGRO_API_URL, oid, token); }));
  const enriched = {
      ...order,
      lineItems: (order.lineItems || []).map(li => ({
        ...li,
        offer: {
          ...li.offer,
          name: offerDetails[li.offer?.id]?.name || li.offer?.name,
          image: offerDetails[li.offer?.id]?.image || null,
        }
      }))
    };
    res.json({ order: enriched });
  } catch (e) {
    console.error('Błąd pobierania pojedynczego zamówienia', e?.response?.status, e?.response?.data);
    res.status(e?.response?.status || 500).json({ error: 'Nie udało się pobrać zamówienia', details: e?.response?.data });
  }
});

// Refund płatności za przedmioty zgłoszone do zwrotu w danym zamówieniu (bez wysyłki/surcharges/additionalServices)
app.post('/api/orders/:id/refund-payment-items', async (req, res) => {
  try {
    const token = getUserAccessToken(req);
    if (!token) return res.status(401).json({ error: 'Brak autoryzacji użytkownika.' });
    const { id } = req.params; // checkoutForm id
    const { reason = 'REFUND', sellerComment } = req.body || {};
    const { ALLEGRO_API_URL } = process.env;
    const headersJson = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.allegro.public.v1+json',
      'Content-Type': 'application/vnd.allegro.public.v1+json'
    };

    // 1) Pobierz zamówienie (payment.id oraz lineItems z lineItem.id, offer.id, quantity)
    const ordResp = await axios.get(`${ALLEGRO_API_URL}/order/checkout-forms/${id}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json' } });
    const order = ordResp.data;
    if (!order?.payment?.id) return res.status(400).json({ error: 'Brak payment.id dla zamówienia' });

    // 2) Pobierz listę zwrotów dla tego zamówienia, aby zidentyfikować offerId pozycji do zwrotu
    const qs = new URLSearchParams({ orderId: id, limit: '1000', offset: '0' });
    const retResp = await axios.get(`${ALLEGRO_API_URL}/order/customer-returns?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.beta.v1+json', 'Accept-Language':'pl-PL' } });
    const customerReturns = Array.isArray(retResp.data?.customerReturns) ? retResp.data.customerReturns : [];
    const returnedOfferIds = new Set();
    customerReturns.forEach(cr => {
      const items = Array.isArray(cr?.items) ? cr.items : [];
      items.forEach(it => { if (it?.offerId) returnedOfferIds.add(String(it.offerId)); });
    });

    // 3) Zbuduj listę lineItems do refundu – tylko te, których offerId jest w returnedOfferIds
    const li = Array.isArray(order?.lineItems) ? order.lineItems : [];
    const refundLineItems = li
      .filter(it => it?.id && it?.offer?.id && returnedOfferIds.has(String(it.offer.id)))
      .map(it => ({ id: it.id, type: 'QUANTITY', quantity: it.quantity || 1 }));
    if (!refundLineItems.length) return res.status(400).json({ error: 'Brak pozycji do zwrotu dla tego zamówienia' });

    // 4) Wyślij refund do Allegro
    const body = {
      payment: { id: order.payment.id },
      reason,
      lineItems: refundLineItems,
      order: { id },
      ...(sellerComment ? { sellerComment } : {}),
      commandId: crypto.randomUUID()
    };
    const refundResp = await axios.post(`${ALLEGRO_API_URL}/payments/refunds`, body, { headers: headersJson });
    res.json({ ok: true, refund: refundResp.data });
  } catch (e) {
    console.error('Refund payment items error', e?.response?.status, e?.response?.data);
    res.status(e?.response?.status || 500).json({ error: 'Nie udało się zlecić zwrotu płatności', details: e?.response?.data, message: e.message });
  }
});

// Zwrot prowizji (refund-claims) dla pozycji zgłoszonych do zwrotu w danym zamówieniu
app.post('/api/orders/:id/refund-commission-claims', async (req, res) => {
  try {
    const token = getUserAccessToken(req);
    if (!token) return res.status(401).json({ error: 'Brak autoryzacji użytkownika.' });
    const { id } = req.params; // checkoutForm id
    const { reason = 'CUSTOMER_RETURN', sellerComment } = req.body || {};
    const { ALLEGRO_API_URL } = process.env;
    const headersJsonBeta = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.allegro.beta.v1+json',
      'Content-Type': 'application/vnd.allegro.beta.v1+json'
    };

    // 1) Pobierz zamówienie (lineItems z lineItem.id, offer.id, quantity)
    const ordResp = await axios.get(`${ALLEGRO_API_URL}/order/checkout-forms/${id}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json' } });
    const order = ordResp.data;
    if (!order?.id) return res.status(404).json({ error: 'Nie znaleziono zamówienia' });

    // 2) Pobierz listę zwrotów dla tego zamówienia, aby zidentyfikować offerId pozycji do zwrotu
    const qs = new URLSearchParams({ orderId: id, limit: '1000', offset: '0' });
    const retResp = await axios.get(`${ALLEGRO_API_URL}/order/customer-returns?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.beta.v1+json', 'Accept-Language':'pl-PL' } });
    const customerReturns = Array.isArray(retResp.data?.customerReturns) ? retResp.data.customerReturns : [];
    const returnedOfferIds = new Set();
    customerReturns.forEach(cr => {
      const items = Array.isArray(cr?.items) ? cr.items : [];
      items.forEach(it => { if (it?.offerId) returnedOfferIds.add(String(it.offerId)); });
    });

    // 3) Zbuduj listę lineItems do zgłoszenia zwrotu prowizji – tylko te, których offerId jest w returnedOfferIds
    const li = Array.isArray(order?.lineItems) ? order.lineItems : [];
    const claimLineItems = li
      .filter(it => it?.id && it?.offer?.id && returnedOfferIds.has(String(it.offer.id)))
      .map(it => ({ id: it.id, quantity: it.quantity || 1 }));
    if (!claimLineItems.length) return res.status(400).json({ error: 'Brak pozycji do zwrotu prowizji dla tego zamówienia' });

    // 4) Wyślij refund-claim do Allegro
    const body = {
      order: { id },
      lineItems: claimLineItems,
      reason,
      ...(sellerComment ? { sellerComment } : {}),
      commandId: crypto.randomUUID()
    };
    try {
      const claimResp = await axios.post(`${ALLEGRO_API_URL}/order/refund-claims`, body, { headers: headersJsonBeta });
      res.json({ ok: true, refundClaim: claimResp.data });
    } catch (e1) {
      // Fallback do public v1 jeśli beta nie działa
      const headersJsonPub = { ...headersJsonBeta, Accept: 'application/vnd.allegro.public.v1+json', 'Content-Type': 'application/vnd.allegro.public.v1+json' };
      const claimResp = await axios.post(`${ALLEGRO_API_URL}/order/refund-claims`, body, { headers: headersJsonPub });
      res.json({ ok: true, refundClaim: claimResp.data, note: 'fallback public v1' });
    }
  } catch (e) {
    console.error('Refund commission (refund-claims) error', e?.response?.status, e?.response?.data);
    res.status(e?.response?.status || 500).json({ error: 'Nie udało się zlecić zwrotu prowizji', details: e?.response?.data, message: e.message });
  }
});

// Sprawdź, czy istnieją zgłoszone zwroty prowizji dla zamówienia
app.get('/api/orders/:id/refund-claims', async (req, res) => {
  try {
    const token = getUserAccessToken(req);
    if (!token) return res.status(401).json({ error: 'Brak autoryzacji użytkownika.' });
  const { id } = req.params; // checkoutForm id
  const includeAllOffers = req.query.all === '1' || req.query.all === 'true';
    const { ALLEGRO_API_URL } = process.env;

    // 1) Pobierz zamówienie -> buyer.login + lineItems (mapa offerId -> Set(lineItemId))
    const ordResp = await axios.get(`${ALLEGRO_API_URL}/order/checkout-forms/${id}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json' }
    });
    const order = ordResp.data;
    const buyerLogin = order?.buyer?.login || '';
    if (!buyerLogin) return res.json({ claims: [], hasAny: false, note: 'Brak buyer.login – nie można filtrować refund-claims' });
    const lineItems = Array.isArray(order?.lineItems) ? order.lineItems : [];
    const offerToLineItemIds = new Map(); // offerId -> Set(lineItemId)
    lineItems.forEach(li => {
      const offerId = li?.offer?.id ? String(li.offer.id) : null;
      const liId = li?.id ? String(li.id) : null;
      if (!offerId || !liId) return;
      if (!offerToLineItemIds.has(offerId)) offerToLineItemIds.set(offerId, new Set());
      offerToLineItemIds.get(offerId).add(liId);
    });

    // 2) Wyznacz zbiór ofert do sprawdzenia: wszystkie z zamówienia lub tylko te, które mają zwroty (customer-returns)
    const returnedOfferIds = new Set();
    if (!includeAllOffers) {
      const qsRet = new URLSearchParams({ orderId: id, limit: '1000', offset: '0' });
      const retResp = await axios.get(`${ALLEGRO_API_URL}/order/customer-returns?${qsRet.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.beta.v1+json', 'Accept-Language':'pl-PL' }
      });
      const customerReturns = Array.isArray(retResp.data?.customerReturns) ? retResp.data.customerReturns : [];
      customerReturns.forEach(cr => {
        const items = Array.isArray(cr?.items) ? cr.items : [];
        items.forEach(it => { if (it?.offerId) returnedOfferIds.add(String(it.offerId)); });
      });
    }

    const headersPub = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json' };
    const fetchClaimsForOffer = async (offerId) => {
      const all = [];
      const limit = 100;
      for (let offset = 0; offset < 1000; offset += limit) { // twardy limit bezpieczeństwa 1000
        const qs = new URLSearchParams();
        qs.set('lineItem.offer.id', String(offerId));
        qs.set('buyer.login', buyerLogin);
        qs.set('limit', String(limit));
        qs.set('offset', String(offset));
        try {
          const r = await axios.get(`${ALLEGRO_API_URL}/order/refund-claims?${qs.toString()}`, { headers: headersPub });
          const arr = Array.isArray(r.data?.refundClaims) ? r.data.refundClaims : (Array.isArray(r.data) ? r.data : []);
          all.push(...arr);
          if (!arr || arr.length < limit) break;
        } catch (e) {
          // Spróbuj beta w razie czego
          const headersBeta = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.beta.v1+json' };
          const r2 = await axios.get(`${ALLEGRO_API_URL}/order/refund-claims?${qs.toString()}`, { headers: headersBeta });
          const arr2 = Array.isArray(r2.data?.refundClaims) ? r2.data.refundClaims : (Array.isArray(r2.data) ? r2.data : []);
          all.push(...arr2);
          if (!arr2 || arr2.length < limit) break;
        }
      }
      return all;
    };

    // 3) Dla każdej zwróconej oferty pobierz listę refund-claims i odfiltruj do lineItems z tego zamówienia
  const targetOffers = includeAllOffers ? Array.from(new Set(lineItems.map(li => String(li?.offer?.id)).filter(Boolean))) : Array.from(returnedOfferIds);
    const CONC = 6;
    let aggregated = [];
    for (let i = 0; i < targetOffers.length; i += CONC) {
      const chunk = targetOffers.slice(i, i + CONC);
      const lists = await Promise.all(chunk.map(oid => fetchClaimsForOffer(oid)));
      lists.forEach((arr, idx) => {
        const offerId = chunk[idx];
        const idsSet = offerToLineItemIds.get(offerId) || new Set();
        const filtered = (arr || []).filter(c => idsSet.has(String(c?.lineItem?.id || '')));
        aggregated.push(...filtered);
      });
    }

  const hasAny = aggregated.length > 0;
  res.json({ claims: aggregated, hasAny, offersChecked: targetOffers.length, scope: includeAllOffers ? 'all' : 'returns-only' });
  } catch (e) {
    console.error('Get order refund-claims error', e?.response?.status, e?.response?.data);
    res.status(e?.response?.status || 500).json({ error: 'Nie udało się pobrać zwrotów prowizji', details: e?.response?.data, message: e.message });
  }
});

// Sprawdź, czy istnieje zwrot płatności dla zamówienia (dowolny refund powiązany z order.id)
app.get('/api/orders/:id/refunds', async (req, res) => {
  try {
    const token = getUserAccessToken(req);
    if (!token) return res.status(401).json({ error: 'Brak autoryzacji użytkownika.' });
    const { id } = req.params;
    const { ALLEGRO_API_URL } = process.env;

    // Najpierw pobierz zamówienie, aby uzyskać payment.id
    const ord = await axios.get(`${ALLEGRO_API_URL}/order/checkout-forms/${id}` , {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json' }
    });
    const paymentId = ord.data?.payment?.id;
    if (!paymentId) {
      return res.json({ refunds: [], hasAny: false, note: 'Brak payment.id – nie można sprawdzić refundów.' });
    }

    // Filtruj wg payment.id oraz status=SUCCESS (zgodnie z dokumentacją)
    const qs = new URLSearchParams();
    qs.set('payment.id', paymentId);
    qs.set('status', 'SUCCESS');
  // Allegro API: limit musi być <= 100
  qs.set('limit', '100');

    const r = await axios.get(`${ALLEGRO_API_URL}/payments/refunds?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json' }
    });
    const refunds = Array.isArray(r.data?.refunds) ? r.data.refunds : (Array.isArray(r.data) ? r.data : []);
    const hasAny = Array.isArray(refunds) && refunds.some(x => (x?.status || '').toUpperCase() === 'SUCCESS');
    res.json({ refunds, hasAny, paymentId });
  } catch (e) {
    console.error('Get order refunds error', e?.response?.status, e?.response?.data);
    res.status(e?.response?.status || 500).json({ error: 'Nie udało się pobrać zwrotów płatności', details: e?.response?.data, message: e.message });
  }
});

// ===== Akcje ofert =====
// Middleware diagnostyczny – loguje każde wejście na prefix akcji ofertowych
app.use('/api/offers/actions', (req, _res, next) => {
  console.log('[offers-actions]', req.method, req.originalUrl);
  next();
});

// Szybki endpoint health do potwierdzenia, że backend ma zarejestrowane trasy
app.get('/api/offers/actions/health', (_req, res) => {
  res.json({ ok: true, routes: ['end','set-last','resume-last'] });
});
function buildOfferCriteria(offerIds=[]) {
  return [ { type: 'CONTAINS_OFFERS', offers: offerIds.map(id => ({ id })) } ];
}

async function sendPublicationCommand(token, apiUrl, offerIds, action) {
  const commandId = crypto.randomUUID();
  try {
    await axios.post(`${apiUrl}/sale/offer-publication-commands/${commandId}`,
      {
        publication: { action },
        offerCriteria: buildOfferCriteria(offerIds)
      },
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json', 'Content-Type':'application/vnd.allegro.public.v1+json' } }
    );
  } catch (e) {
    console.error('Publication command error', action, e?.response?.status, e?.response?.data);
    throw e;
  }
  return commandId;
}

async function sendQuantityFixedCommand(token, apiUrl, offerIds, value) {
  const commandId = crypto.randomUUID();
  const body = {
    modification: { changeType: 'FIXED', value },
    offerCriteria: buildOfferCriteria(offerIds)
  };
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json', 'Content-Type':'application/vnd.allegro.public.v1+json' };
  try {
    // Zgodnie z dokumentacją powinno być PUT z commandId
    await axios.put(`${apiUrl}/sale/offer-quantity-change-commands/${commandId}`, body, { headers });
    return commandId;
  } catch (e) {
    const status = e?.response?.status;
    if (status === 405) {
      // Fallback – niektóre wersje API mogą oczekiwać POST bez commandId w ścieżce
      console.warn('405 na endpointzie PUT z commandId – próba fallback PUT bez commandId (legacy)');
      try {
        const r2 = await axios.put(`${apiUrl}/sale/offer-quantity-change-commands`, body, { headers });
        const returnedId = r2.data?.id || r2.data?.commandId || commandId;
        return returnedId;
      } catch (e2) {
        console.error('Fallback quantity change także nieudany', e2?.response?.status, e2?.response?.data);
        throw e2;
      }
    }
    console.error('Quantity command error FIXED', value, status, e?.response?.data);
    throw e;
  }
}

// PATCH pojedynczej oferty (status ACTIVE/ENDED) – jeśli mamy tylko 1 ID
async function patchSingleOfferStatus(token, apiUrl, offerId, status) {
  try {
    await axios.patch(`${apiUrl}/sale/product-offers/${offerId}`, {
      publication: { status }
    }, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json', 'Content-Type':'application/vnd.allegro.public.v1+json' }
    });
    return { offerId, status };
  } catch (e) {
    console.error('PATCH product-offer status error', offerId, status, e?.response?.status, e?.response?.data);
    throw e;
  }
}

// Zakończ oferty
app.post('/api/offers/actions/end', async (req, res) => {
  try {
  const token = getUserAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Brak autoryzacji' });
    const { ALLEGRO_API_URL } = process.env;
    const offerIds = Array.isArray(req.body.offerIds) ? req.body.offerIds.filter(Boolean) : [];
    if (!offerIds.length) return res.status(400).json({ error: 'Brak offerIds' });
  console.log('[offers-actions] end', { offerIdsCount: offerIds.length });
    if (offerIds.length === 1) {
      const r = await patchSingleOfferStatus(token, ALLEGRO_API_URL, offerIds[0], 'ENDED');
  return res.json({ ok: true, single: true, result: r });
    }
    const cmd = await sendPublicationCommand(token, ALLEGRO_API_URL, offerIds, 'END');
  res.json({ ok:true, single:false, commandId: cmd });
  } catch (e) {
  console.error('End offers error', e?.response?.status, e?.response?.data);
    res.status(e?.response?.status||500).json({ error: e.message, details: e?.response?.data });
  }
});

// Ustaw ostatnia sztukę (quantity=1)
app.post('/api/offers/actions/set-last', async (req, res) => {
  try {
  const token = getUserAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Brak autoryzacji' });
    const { ALLEGRO_API_URL } = process.env;
    const offerIds = Array.isArray(req.body.offerIds) ? req.body.offerIds.filter(Boolean) : [];
    if (!offerIds.length) return res.status(400).json({ error: 'Brak offerIds' });
  console.log('[offers-actions] set-last', { offerIdsCount: offerIds.length });
    const cmd = await sendQuantityFixedCommand(token, ALLEGRO_API_URL, offerIds, 1);
  res.json({ ok:true, commandId: cmd });
  } catch (e) {
  console.error('Set last error', e?.response?.status, e?.response?.data);
    res.status(e?.response?.status||500).json({ error: e.message, details: e?.response?.data });
  }
});

// Wznów i ustaw ostatnią sztukę
app.post('/api/offers/actions/resume-last', async (req, res) => {
  try {
  const token = getUserAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Brak autoryzacji' });
    const { ALLEGRO_API_URL } = process.env;
    const offerIds = Array.isArray(req.body.offerIds) ? req.body.offerIds.filter(Boolean) : [];
    if (!offerIds.length) return res.status(400).json({ error: 'Brak offerIds' });
  console.log('[offers-actions] resume-last (activate + set 1)', { offerIdsCount: offerIds.length });
    if (offerIds.length === 1) {
      await patchSingleOfferStatus(token, ALLEGRO_API_URL, offerIds[0], 'ACTIVE');
      const qtyCmdSingle = await sendQuantityFixedCommand(token, ALLEGRO_API_URL, offerIds, 1);
  return res.json({ ok: true, single: true, quantityCommandId: qtyCmdSingle });
    }
    const pubCmd = await sendPublicationCommand(token, ALLEGRO_API_URL, offerIds, 'ACTIVATE');
    const qtyCmd = await sendQuantityFixedCommand(token, ALLEGRO_API_URL, offerIds, 1);
  res.json({ ok:true, single:false, publicationCommandId: pubCmd, quantityCommandId: qtyCmd });
  } catch (e) {
  console.error('Resume last error', e?.response?.status, e?.response?.data);
    res.status(e?.response?.status||500).json({ error: e.message, details: e?.response?.data });
  }
});

app.listen(PORT, () => {
  console.log(`Allegro backend listening on port ${PORT}`);
});
