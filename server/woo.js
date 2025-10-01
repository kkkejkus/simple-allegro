import express from 'express';
import axios from 'axios';

// Router do obsługi dwóch kont WooCommerce: outdoorowe, sklepbastion
// Teraz: jeśli dane są w .env, nie trzeba wpisywać w formularzu – sesja uzupełni się automatycznie.
// Weryfikacja możliwa przez POST /woo/login albo opcjonalnie GET /woo/verify?store=...

const router = express.Router();

const STORE_KEYS = ['outdoorowe','sklepbastion'];

const ENV_CONF = {
  outdoorowe: {
    baseUrl: process.env.WOO_API_URL_OUTDOOROWE || '',
    key: process.env.WOO_CLIENT_ID_OUTDOOROWE || '',
    secret: process.env.WOO_CLIENT_SECRET_OUTDOOROWE || ''
  },
  sklepbastion: {
    baseUrl: process.env.WOO_API_URL_SKLEPBASTION || '',
    key: process.env.WOO_CLIENT_ID_SKLEPBASTION || '',
    secret: process.env.WOO_CLIENT_SECRET_SKLEPBASTION || ''
  }
};

function getStoreSession(req) {
  req.session.wooStores = req.session.wooStores || {}; // store -> { baseUrl, key, secret, verifiedAt }
  return req.session.wooStores;
}

function autoInitFromEnv(req) {
  const stores = getStoreSession(req);
  for (const name of STORE_KEYS) {
    if (!stores[name]) {
      const env = ENV_CONF[name];
      if (env.baseUrl && env.key && env.secret) {
        stores[name] = { baseUrl: env.baseUrl.replace(/\/$/, ''), key: env.key, secret: env.secret, verifiedAt: null };
      }
    }
  }
}

router.get('/status', (req, res) => {
  autoInitFromEnv(req);
  const stores = getStoreSession(req);
  const status = STORE_KEYS.map(name => ({
    name,
    connected: !!stores[name],
    baseUrl: stores[name]?.baseUrl || null,
    verifiedAt: stores[name]?.verifiedAt || null,
    fromEnv: !!(ENV_CONF[name].baseUrl && ENV_CONF[name].key && ENV_CONF[name].secret)
  }));
  res.json({ stores: status });
});

router.post('/login', async (req, res) => {
  try {
    const { store, baseUrl, key, secret } = req.body || {};
    if (!STORE_KEYS.includes(store)) return res.status(400).json({ error: 'Nieznany store' });
    if (!baseUrl || !key || !secret) return res.status(400).json({ error: 'Brak baseUrl/key/secret' });
    const normBase = baseUrl.replace(/\/$/, '');
    const url = `${normBase}/wp-json/wc/v3/orders?per_page=1`;
    const auth = { username: key, password: secret };
    // Weryfikacja prostym requestem (ignorujemy błędy 401/403 dla jasnego komunikatu)
    const r = await axios.get(url, { auth, params: { _fields: 'id' } });
    // Jeśli sukces
    const stores = getStoreSession(req);
    stores[store] = { baseUrl: normBase, key, secret, verifiedAt: new Date().toISOString() };
    res.json({ ok: true, store, countPreview: Array.isArray(r.data) ? r.data.length : 0 });
  } catch (e) {
    const status = e?.response?.status;
    res.status(status || 500).json({ error: 'Weryfikacja nieudana', status, details: e?.response?.data });
  }
});

router.post('/logout', (req, res) => {
  const { store } = req.body || {};
  if (!STORE_KEYS.includes(store)) return res.status(400).json({ error: 'Nieznany store' });
  const stores = getStoreSession(req);
  if (stores[store]) delete stores[store];
  res.json({ ok: true, store });
});

// Opcjonalna weryfikacja po auto-inicjalizacji z .env
router.get('/verify', async (req, res) => {
  try {
    const { store } = req.query;
    if (!STORE_KEYS.includes(store)) return res.status(400).json({ error: 'Nieznany store' });
    autoInitFromEnv(req);
    const stores = getStoreSession(req);
    const cfg = stores[store];
    if (!cfg) return res.status(400).json({ error: 'Brak danych store' });
    const url = `${cfg.baseUrl}/wp-json/wc/v3/orders?per_page=1`;
    const r = await axios.get(url, { auth: { username: cfg.key, password: cfg.secret }, params: { _fields: 'id' } });
    cfg.verifiedAt = new Date().toISOString();
    res.json({ ok: true, store, countPreview: Array.isArray(r.data) ? r.data.length : 0, verifiedAt: cfg.verifiedAt });
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: 'Weryfikacja nieudana', details: e?.response?.data });
  }
});

// Przykładowy endpoint pobrania kilku ostatnich zamówień Woo (opcjonalne wykorzystanie dalej)
router.get('/orders', async (req, res) => {
  try {
    const { store } = req.query;
    if (!STORE_KEYS.includes(store)) return res.status(400).json({ error: 'Nieznany store' });
    const stores = getStoreSession(req);
    const cfg = stores[store];
    if (!cfg) return res.status(401).json({ error: 'Store niepołączony' });
    const url = `${cfg.baseUrl}/wp-json/wc/v3/orders`;
    const reqId = Math.random().toString(36).slice(2, 8);
    console.time(`[Woo ${store} ${reqId}] total`);
    // Pobieramy pełniejsze dane (line_items + billing dla nazwy kupującego)
    const days = parseInt(req.query.days, 10);
    const cutoff = !isNaN(days) && days > 0 ? new Date(Date.now() - days * 86400000) : null;

// Pojedynczy produkt (debug) – do diagnozy modelu/atrybutów
router.get('/product/:id', async (req, res) => {
  try {
    const { store } = req.query;
    const { id } = req.params;
    if (!STORE_KEYS.includes(store)) return res.status(400).json({ error: 'Nieznany store' });
    const stores = getStoreSession(req);
    const cfg = stores[store];
    if (!cfg) return res.status(401).json({ error: 'Store niepołączony' });
    const url = `${cfg.baseUrl}/wp-json/wc/v3/products/${id}`;
    const r = await axios.get(url, { auth: { username: cfg.key, password: cfg.secret } });
    return res.json({ product: r.data });
  } catch (e) { return res.status(e?.response?.status || 500).json({ error: 'Błąd pobierania produktu Woo', details: e?.response?.data }); }
});
    console.time(`[Woo ${store} ${reqId}] fetch orders`);
    const ordersParams = { per_page: 50, order: 'desc' };
    if (cutoff) {
      // Zawęź po stronie Woo – mniej danych do przetworzenia
      ordersParams.after = cutoff.toISOString();
    }
    // Zawężenie pól (WP REST _fields) – top-level; może nie ograniczyć zagnieżdżonych, ale warto spróbować
    ordersParams._fields = [
      'id', 'number', 'status', 'total', 'currency', 'date_created', 'date_paid',
      'shipping_lines', 'line_items', 'billing', 'meta_data', 'customer_note'
    ].join(',');
    const r = await axios.get(url, { auth: { username: cfg.key, password: cfg.secret }, params: ordersParams });
    console.timeEnd(`[Woo ${store} ${reqId}] fetch orders`);
    const raw = Array.isArray(r.data) ? r.data : [];
    const filtered = cutoff ? raw.filter(o => {
      try { return new Date(o.date_created) >= cutoff; } catch { return true; }
    }) : raw;
    // 1) Zbierz unikalne product_id do pobrania atrybutów produktu (dla modelu)
    //    TYLKO dla pozycji, gdzie brak modelu w meta_data – resztę pomijamy.
    const productIdSet = new Set();
    filtered.forEach(ord => (ord.line_items || []).forEach(li => {
      if (!li?.product_id) return;
      try {
        const md = li.meta_data || [];
        const found = md.find(m => {
          const k = (m?.key || m?.display_key || '').toString().toLowerCase();
          return k.includes('model');
        });
        if (!found) productIdSet.add(li.product_id);
      } catch {
        productIdSet.add(li.product_id);
      }
    }));
    let productIds = Array.from(productIdSet);

    // 2) Cache produktów w pamięci, aby ograniczyć liczbę wywołań
    if (!global.__WOO_PRODUCT_CACHE__) global.__WOO_PRODUCT_CACHE__ = { map: new Map(), ttl: 24 * 60 * 60 * 1000 };
    const PRODUCT_TTL_MS = global.__WOO_PRODUCT_CACHE__.ttl;
    const productCache = global.__WOO_PRODUCT_CACHE__.map; // id -> { data, ts }

    const now = Date.now();
    const fromCache = {};
    const missingIds = [];
    for (const pid of productIds) {
      const entry = productCache.get(pid);
      if (entry && (now - entry.ts) < PRODUCT_TTL_MS) {
        fromCache[pid] = entry.data;
      } else {
        missingIds.push(pid);
      }
    }

    // 3) Pobierz brakujące produkty partiami (równolegle, z limitem współbieżności)
    const productMap = { ...fromCache };
    if (missingIds.length > 0) {
      console.time(`[Woo ${store} ${reqId}] fetch products total`);
      const chunkSize = 80; // większe paczki zmniejszają liczbę requestów (max per_page 100)
      const chunks = [];
      for (let i = 0; i < missingIds.length; i += chunkSize) chunks.push(missingIds.slice(i, i + chunkSize));
      const CONCURRENCY = 4;
      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const group = chunks.slice(i, i + CONCURRENCY);
        console.time(`[Woo ${store} ${reqId}] products group ${i / CONCURRENCY}`);
        const results = await Promise.all(group.map(async chunk => {
          try {
            const pr = await axios.get(`${cfg.baseUrl}/wp-json/wc/v3/products`, {
              auth: { username: cfg.key, password: cfg.secret },
              params: { per_page: Math.min(100, chunk.length), include: chunk, _fields: 'id,attributes' }
            });
            const arr = Array.isArray(pr.data) ? pr.data : [];
            return arr;
          } catch (e) {
            return [];
          }
        }));
        const flat = results.flat();
        flat.forEach(p => {
          if (p && p.id != null) {
            productMap[p.id] = p;
            productCache.set(p.id, { data: p, ts: Date.now() });
          }
        });
        console.timeEnd(`[Woo ${store} ${reqId}] products group ${i / CONCURRENCY}`);
      }
      console.timeEnd(`[Woo ${store} ${reqId}] fetch products total`);
    }

    // 3) Helper do wyciągania modelu z produktu
    const getModelFromProduct = (p) => {
      if (!p) return undefined;
      try {
        const attrs = p.attributes || [];
        const found = attrs.find(a => {
          const n = (a?.name || '').toString().toLowerCase();
          const s = (a?.slug || '').toString().toLowerCase();
          return n.includes('model') || s.includes('model');
        });
        if (!found) return undefined;
        const val = Array.isArray(found.options) ? found.options.join(', ') : (found.option || found.options);
        return typeof val === 'string' ? val : (val != null ? String(val) : undefined);
      } catch { return undefined; }
    };

    // 3b) Normalizacja powtarzających się modeli (np. "DRAKON, DRAKON, DRAKON" -> "DRAKON")
    const normalizeModel = (raw) => {
      if (!raw || typeof raw !== 'string') return raw;
      // Rozdziel po przecinkach/średnikach, przytnij i usuń puste.
      const parts = raw
        .split(/[;,]/)
        .map(s => s.trim())
        .filter(Boolean);
      if (parts.length <= 1) return parts[0] || raw.trim();
      // Usuń duplikaty (case-insensitive) zachowując kolejność pierwszego wystąpienia
      const seen = new Set();
      const uniq = [];
      for (const p of parts) {
        const key = p.toLowerCase();
        if (!seen.has(key)) { seen.add(key); uniq.push(p); }
      }
      return uniq.join(', ');
    };

    // 4) Zmapuj zamówienia z dołączonym modelem dla pozycji
    const mapped = filtered.map(o => ({
      id: o.id,
      number: o.number,
      status: o.status,
      total: parseFloat(o.total),
      currency: o.currency,
      date: o.date_created,
      datePaid: o.date_paid,
      customerNote: o.customer_note || undefined,
      deliveryMethod: (Array.isArray(o.shipping_lines) && o.shipping_lines.length ? o.shipping_lines[0]?.method_title : null),
      shippingTotalGross: (Array.isArray(o.shipping_lines) ? o.shipping_lines.reduce((sum, sl) => sum + (parseFloat(sl.total || '0') + parseFloat(sl.total_tax || '0')), 0) : 0),
      lineItems: (o.line_items || []).map(li => {
        // a) Model z meta_data pozycji (jeśli występuje)
        let modelFromMeta;
        try {
          const md = li.meta_data || [];
          const found = md.find(m => {
            const k = (m?.key || m?.display_key || '').toString().toLowerCase();
            return k.includes('model');
          });
          const val = found ? (found.display_value || found.value) : undefined;
          modelFromMeta = typeof val === 'string' ? val : (val != null ? String(val) : undefined);
        } catch {}

        // b) Jeśli brak w meta, spróbuj z atrybutów produktu
  const modelFromProduct = getModelFromProduct(productMap[li.product_id]);

        return {
          id: li.id,
          name: li.name,
          quantity: li.quantity,
          price: parseFloat(li.price),
          total: parseFloat(li.total),
          totalTax: parseFloat(li.total_tax || '0'),
          productId: li.product_id,
          variationId: li.variation_id,
          sku: li.sku,
          image: li.image && li.image.src ? { src: li.image.src } : (li.image || undefined),
          imageSrc: li.image?.src || undefined,
          model: normalizeModel(modelFromMeta || modelFromProduct)
        };
      }),
      billing: o.billing || null,
      metaData: o.meta_data || []
    }));
  console.timeEnd(`[Woo ${store} ${reqId}] total`);
  res.json({ store, orders: mapped });
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: 'Błąd pobierania zamówień Woo', details: e?.response?.data });
  }
});

// Pojedyncze zamówienie (debug) – zwraca surowe dane z WooCommerce
router.get('/order/:id', async (req, res) => {
  try {
    const { store } = req.query;
    const { id } = req.params;
    if (!STORE_KEYS.includes(store)) return res.status(400).json({ error: 'Nieznany store' });
    const stores = getStoreSession(req);
    const cfg = stores[store];
    if (!cfg) return res.status(401).json({ error: 'Store niepołączony' });
    const url = `${cfg.baseUrl}/wp-json/wc/v3/orders/${id}`;
    const r = await axios.get(url, { auth: { username: cfg.key, password: cfg.secret } });
    res.json({ store, order: r.data });
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: 'Błąd pobierania zamówienia Woo', details: e?.response?.data });
  }
});

// Notatki zamówienia (order notes). Zwraca listę komentarzy Woo typu order_note.
router.get('/order-notes', async (req, res) => {
  try {
    const { store, id } = req.query;
    if (!STORE_KEYS.includes(store)) return res.status(400).json({ error: 'Nieznany store' });
    if (!id) return res.status(400).json({ error: 'Brak id' });
    const stores = getStoreSession(req);
    const cfg = stores[store];
    if (!cfg) return res.status(401).json({ error: 'Store niepołączony' });
    const url = `${cfg.baseUrl}/wp-json/wc/v3/orders/${id}/notes`;
  // Nie ograniczamy _fields – Woo czasem nie zwraca added_by_user przy zawężeniu
  const r = await axios.get(url, { auth: { username: cfg.key, password: cfg.secret }, params: { per_page: 50 } });
    const notes = Array.isArray(r.data) ? r.data : [];
    res.json({ store, id, notes });
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: 'Błąd pobierania notatek', details: e?.response?.data });
  }
});

// Helper: aktualizacja produktu lub wariantu w WooCommerce
async function updateWooProduct(cfg, { productId, variationId, data }) {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const auth = { username: cfg.key, password: cfg.secret };
  if (variationId) {
    // Aktualizacja wariantu
    const url = `${base}/wp-json/wc/v3/products/${productId}/variations/${variationId}`;
    const r = await axios.put(url, data, { auth });
    return r.data;
  } else {
    const url = `${base}/wp-json/wc/v3/products/${productId}`;
    const r = await axios.put(url, data, { auth });
    return r.data;
  }
}

// Ustaw 1 sztukę i wystaw (publish/instock)
router.post('/product/set-one', async (req, res) => {
  try {
    const { store, productId, variationId } = req.body || {};
    if (!STORE_KEYS.includes(store)) return res.status(400).json({ error: 'Nieznany store' });
    const stores = getStoreSession(req);
    const cfg = stores[store];
    if (!cfg) return res.status(401).json({ error: 'Store niepołączony' });
    if (!productId) return res.status(400).json({ error: 'Brak productId' });
    const data = {
      manage_stock: true,
      stock_quantity: 1
    };
    const updated = await updateWooProduct(cfg, { productId, variationId, data });
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: 'Błąd set-one', details: e?.response?.data || e.message });
  }
});

// Zakończ (wyzeruj stan i ustaw outofstock)
router.post('/product/end', async (req, res) => {
  try {
    const { store, productId, variationId } = req.body || {};
    if (!STORE_KEYS.includes(store)) return res.status(400).json({ error: 'Nieznany store' });
    const stores = getStoreSession(req);
    const cfg = stores[store];
    if (!cfg) return res.status(401).json({ error: 'Store niepołączony' });
    if (!productId) return res.status(400).json({ error: 'Brak productId' });
    const data = {
      manage_stock: true,
      stock_quantity: 0
      // UWAGA: nie zmieniamy statusu ani stock_status, tylko ilość.
    };
    const updated = await updateWooProduct(cfg, { productId, variationId, data });
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: 'Błąd end', details: e?.response?.data || e.message });
  }
});

// Wznów (instock; domyślnie 1 szt.)
router.post('/product/resume', async (req, res) => {
  try {
    const { store, productId, variationId } = req.body || {};
    if (!STORE_KEYS.includes(store)) return res.status(400).json({ error: 'Nieznany store' });
    const stores = getStoreSession(req);
    const cfg = stores[store];
    if (!cfg) return res.status(401).json({ error: 'Store niepołączony' });
    if (!productId) return res.status(400).json({ error: 'Brak productId' });
    const data = {
      manage_stock: true,
      stock_quantity: 1
    };
    const updated = await updateWooProduct(cfg, { productId, variationId, data });
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: 'Błąd resume', details: e?.response?.data || e.message });
  }
});

export default router;
