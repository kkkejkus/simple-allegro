export type OrderItem = {
  id: string;
  name: string;
  image?: string;
  quantity: number;
  unitPrice?: number; // cena jednostkowa
  totalPrice?: number; // cena * ilość
  currency?: string;
  isShipping?: boolean; // znacznik linii wysyłki
};

export type Order = {
  id: string;
  status: string;
  createdAt: string;
  buyer: string;
  // Jawny login kupującego z Allegro (utrwalony, by tooltip nie tracił wartości gdy buyer jest tylko stringiem)
  buyerLogin?: string;
  buyerFullName?: string;
  buyerFirstName?: string;
  buyerLastName?: string;
  // Oryginalny obiekt kupującego z Allegro (login, firstName, lastName, address...)
  buyerObject?: any;
  // Dodatkowe dane kupującego z Allegro API
  buyerId?: string;
  buyerEmail?: string;
  buyerPhone?: string; // buyer.phoneNumber
  buyerGuest?: boolean;
  buyerAddressStreet?: string;
  buyerAddressCity?: string;
  buyerAddressPostCode?: string;
  // Dane adresowe dostawy (delivery.address)
  deliveryFirstName?: string;
  deliveryLastName?: string;
  deliveryStreet?: string;
  deliveryCity?: string;
  deliveryPostCode?: string;
  deliveryPhone?: string;
  // Płatność
  paymentType?: string;
  paymentFinishedAt?: string;
  paymentId?: string;
  // Notatka kupującego (pozostaje) – wewnętrzne notatki sprzedającego usunięte
  buyerNote?: string;
  // Notatka sprzedającego (tylko odczyt z Allegro API) – pole order.note.text
  sellerNote?: string;
  items: OrderItem[];
  totalAmount?: number;
  currency?: string;
  deliveryMethod?: string;
  paymentStatus?: string;
  isPaid?: boolean;
  hasInvoice?: boolean;
  invoiceCompanyName?: string;
  invoiceStreet?: string;
  invoiceStreetNumber?: string;
  invoiceFlatNumber?: string;
  invoicePostCode?: string;
  invoiceCity?: string;
  invoicePhone?: string;
  invoiceTaxId?: string;
};

export type Return = {
  id: string;
  orderId: string;
  reason: string;
  createdAt: string;
  referenceNumber?: string;
  itemsOfferIds?: string[];
};

export async function fetchOrdersToday(days: number = 7): Promise<Order[]> {
  const allowed = [1,2,3,4,5,7,10,14];
  const d = allowed.includes(days) ? days : 7;
  const res = await fetch(`/api/orders?days=${d}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Błąd pobierania zamówień z backendu');
  const data = await res.json();

  return (data.checkoutForms || []).map((order: any) => {
    const currencyFallback = order?.lineItems?.[0]?.price?.currency || order?.delivery?.cost?.currency || 'PLN';
    const cap = (s?: string) => s ? (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()) : '';
    const items: OrderItem[] = (order.lineItems || []).map((item: any) => {
      const quantity = item.quantity || 1;
      const unitPriceRaw = item.price?.amount || item.offer?.sellingMode?.price?.amount;
      const unitPrice = unitPriceRaw ? parseFloat(unitPriceRaw) : undefined;
      const totalPrice = unitPrice !== undefined ? unitPrice * quantity : undefined;
      return {
        id: item.offer?.id,
        name: item.offer?.name || 'Produkt',
        image: item.offer?.image || item.offer?.images?.[0]?.url || item.offer?.primaryImage?.url,
        quantity,
        unitPrice,
        totalPrice,
        currency: item.price?.currency || item.offer?.sellingMode?.price?.currency || currencyFallback,
      };
    });

    // Dodaj wysyłkę jako osobny "produkt" jeśli jest płatna
    const shippingAmountRaw = order.delivery?.cost?.amount;
    const shippingAmount = shippingAmountRaw ? parseFloat(shippingAmountRaw) : 0;
    if (shippingAmount > 0) {
      items.push({
        id: 'shipping',
        name: 'Wysyłka',
        quantity: 1,
        unitPrice: shippingAmount,
        totalPrice: shippingAmount,
        currency: order.delivery?.cost?.currency || currencyFallback,
        isShipping: true,
      });
    }

    const totalAmount = items.reduce((sum, it) => sum + (it.totalPrice || 0), 0);
    function sanitizeNote(raw: any): string | undefined {
      if (raw == null) return undefined;
      if (typeof raw === 'string') return raw.trim() || undefined;
      if (typeof raw === 'object') {
        const candidate = raw.text || raw.message || raw.note || raw.value;
        if (typeof candidate === 'string') return candidate.trim() || undefined;
        try { return JSON.stringify(raw); } catch { return undefined; }
      }
      return String(raw);
    }
  const buyerNote = sanitizeNote(order.messageToSeller || order.buyer?.messageToSeller);
  const sellerNote = sanitizeNote(order.note?.text || order.note);
    const buyerFullNameRaw = [order.buyer?.firstName, order.buyer?.lastName].filter(Boolean).join(' ');
    const buyerFullName = buyerFullNameRaw ? buyerFullNameRaw.split(/\s+/).map(cap).join(' ') : undefined;
    const deliveryMethod = order.delivery?.method?.name || order.delivery?.method?.id || undefined;
    const paymentStatus = order?.status;
    const isPaid = paymentStatus === 'PAID' || paymentStatus === 'READY_FOR_PROCESSING';
  const buyerObj = order.buyer || {};
  const buyerAddr = buyerObj.address || {};
  const deliveryAddr = order.delivery?.address || {};
  const paymentObj = order.payment || {};
    const inv = order.invoice?.address;
    let invoiceStreet: string | undefined = inv?.street;
    let invoiceStreetNumber: string | undefined;
    let invoiceFlatNumber: string | undefined;
    if (invoiceStreet) {
      const m = invoiceStreet.match(/^(.*?)(?:\s+(\d+[A-Za-z]?))(?:[\/\\](\d+[A-Za-z]?))?$/);
      if (m) {
        invoiceStreet = m[1].trim();
        invoiceStreetNumber = m[2];
        invoiceFlatNumber = m[3];
      }
    }
    const invoiceCompanyName = inv?.company?.name || order.buyer?.companyName || undefined;
    const invoicePostCode = inv?.zipCode || inv?.postCode;
    const invoiceCity = inv?.city;
    const invoicePhone = inv?.phoneNumber || order.buyer?.phoneNumber;
    const invoiceTaxId = inv?.company?.taxId || inv?.taxId;
    const hasInvoice = !!(invoiceCompanyName || invoiceTaxId || order.invoice?.required);

    return {
      id: order.id,
      status: order.fulfillment?.status,
      createdAt: order.boughtAt || order.updatedAt || order.createdAt,
      buyer: order.buyer?.login || 'Nieznany',
  buyerLogin: order.buyer?.login,
      buyerFullName,
      buyerFirstName: order.buyer?.firstName,
      buyerLastName: order.buyer?.lastName,
      buyerObject: order.buyer ? { ...order.buyer } : undefined,
    buyerId: buyerObj.id,
    buyerEmail: buyerObj.email,
    buyerPhone: buyerObj.phoneNumber,
    buyerGuest: buyerObj.guest,
    buyerAddressStreet: buyerAddr.street,
    buyerAddressCity: buyerAddr.city,
    buyerAddressPostCode: buyerAddr.postCode,
    deliveryFirstName: deliveryAddr.firstName,
    deliveryLastName: deliveryAddr.lastName,
    deliveryStreet: deliveryAddr.street,
    deliveryCity: deliveryAddr.city,
    deliveryPostCode: deliveryAddr.zipCode || deliveryAddr.postCode,
    deliveryPhone: deliveryAddr.phoneNumber,
    paymentType: paymentObj.type,
    paymentFinishedAt: paymentObj.finishedAt,
    paymentId: paymentObj.id,
  buyerNote,
  sellerNote,
      items,
      totalAmount,
      currency: currencyFallback,
      deliveryMethod,
      paymentStatus,
      isPaid,
      hasInvoice,
      invoiceCompanyName,
      invoiceStreet,
      invoiceStreetNumber,
      invoiceFlatNumber,
      invoicePostCode,
      invoiceCity,
      invoicePhone,
      invoiceTaxId,
    } as Order;
  });
}

export async function fetchReturns(days?: number): Promise<Return[]> {
  const res = await fetch(`/api/returns${days ? `?days=${encodeURIComponent(days)}` : ''}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Błąd pobierania zwrotów');
  const data = await res.json();
  const arr = Array.isArray(data?.returns) ? data.returns : [];
  return arr.map((r:any) => ({
    id: r.id,
    orderId: r.orderId,
    reason: r.status || '',
    createdAt: r.createdAt,
    referenceNumber: r.referenceNumber || r.refNumber || undefined,
    itemsOfferIds: Array.isArray(r.itemsOfferIds) ? r.itemsOfferIds : []
  }));
}

export async function setOrderProcessing(orderId: string): Promise<void> {
  const res = await fetch(`/api/orders/${orderId}/processing`, { method: 'POST', headers:{ 'Accept':'application/json' }, credentials:'include' });
  if (!res.ok) throw new Error('Nie udało się ustawić statusu PROCESSING');
}

// Pobierz pojedyncze zamówienie Allegro (z backendu /api/orders/:id) i zmapuj do typu Order
export async function fetchOrderById(orderId: string): Promise<Order> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Błąd pobierania zamówienia');
  const data = await res.json();
  const order = data.order || data;
  const currencyFallback = order?.lineItems?.[0]?.price?.currency || order?.delivery?.cost?.currency || 'PLN';
  const cap = (s?: string) => s ? (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()) : '';
  const items: OrderItem[] = (order.lineItems || []).map((item: any) => {
    const quantity = item.quantity || 1;
    const unitPriceRaw = item.price?.amount || item.offer?.sellingMode?.price?.amount;
    const unitPrice = unitPriceRaw ? parseFloat(unitPriceRaw) : undefined;
    const totalPrice = unitPrice !== undefined ? unitPrice * quantity : undefined;
    return {
      id: item.offer?.id,
      name: item.offer?.name || 'Produkt',
      image: item.offer?.image || item.offer?.images?.[0]?.url || item.offer?.primaryImage?.url,
      quantity,
      unitPrice,
      totalPrice,
      currency: item.price?.currency || item.offer?.sellingMode?.price?.currency || currencyFallback,
    };
  });

  const shippingAmountRaw = order.delivery?.cost?.amount;
  const shippingAmount = shippingAmountRaw ? parseFloat(shippingAmountRaw) : 0;
  if (shippingAmount > 0) {
    items.push({
      id: 'shipping',
      name: 'Wysyłka',
      quantity: 1,
      unitPrice: shippingAmount,
      totalPrice: shippingAmount,
      currency: order.delivery?.cost?.currency || currencyFallback,
      isShipping: true,
    });
  }

  const totalAmount = items.reduce((sum, it) => sum + (it.totalPrice || 0), 0);
  function sanitizeNote(raw: any): string | undefined {
    if (raw == null) return undefined;
    if (typeof raw === 'string') return raw.trim() || undefined;
    if (typeof raw === 'object') {
      const candidate = raw.text || raw.message || raw.note || raw.value;
      if (typeof candidate === 'string') return candidate.trim() || undefined;
      try { return JSON.stringify(raw); } catch { return undefined; }
    }
    return String(raw);
  }
  const buyerNote = sanitizeNote(order.messageToSeller || order.buyer?.messageToSeller);
  const sellerNote = sanitizeNote(order.note?.text || order.note);
  const buyerFullNameRaw = [order.buyer?.firstName, order.buyer?.lastName].filter(Boolean).join(' ');
  const buyerFullName = buyerFullNameRaw ? buyerFullNameRaw.split(/\s+/).map(cap).join(' ') : undefined;
  const deliveryMethod = order.delivery?.method?.name || order.delivery?.method?.id || undefined;
  const paymentStatus = order?.status;
  const isPaid = paymentStatus === 'PAID' || paymentStatus === 'READY_FOR_PROCESSING';
  const buyerObj = order.buyer || {};
  const buyerAddr = buyerObj.address || {};
  const deliveryAddr = order.delivery?.address || {};
  const paymentObj = order.payment || {};
  const inv = order.invoice?.address;
  let invoiceStreet: string | undefined = inv?.street;
  let invoiceStreetNumber: string | undefined;
  let invoiceFlatNumber: string | undefined;
  if (invoiceStreet) {
    const m = invoiceStreet.match(/^(.*?)(?:\s+(\d+[A-Za-z]?))(?:[\/\\](\d+[A-Za-z]?))?$/);
    if (m) {
      invoiceStreet = m[1].trim();
      invoiceStreetNumber = m[2];
      invoiceFlatNumber = m[3];
    }
  }
  const invoiceCompanyName = inv?.company?.name || order.buyer?.companyName || undefined;
  const invoicePostCode = inv?.zipCode || inv?.postCode;
  const invoiceCity = inv?.city;
  const invoicePhone = inv?.phoneNumber || order.buyer?.phoneNumber;
  const invoiceTaxId = inv?.company?.taxId || inv?.taxId;
  const hasInvoice = !!(invoiceCompanyName || invoiceTaxId || order.invoice?.required);

  return {
    id: order.id,
    status: order.fulfillment?.status,
    createdAt: order.boughtAt || order.updatedAt || order.createdAt,
    buyer: order.buyer?.login || 'Nieznany',
  buyerLogin: order.buyer?.login,
    buyerFullName,
    buyerFirstName: order.buyer?.firstName,
    buyerLastName: order.buyer?.lastName,
    buyerObject: order.buyer ? { ...order.buyer } : undefined,
  buyerId: buyerObj.id,
  buyerEmail: buyerObj.email,
  buyerPhone: buyerObj.phoneNumber,
  buyerGuest: buyerObj.guest,
  buyerAddressStreet: buyerAddr.street,
  buyerAddressCity: buyerAddr.city,
  buyerAddressPostCode: buyerAddr.postCode,
  deliveryFirstName: deliveryAddr.firstName,
  deliveryLastName: deliveryAddr.lastName,
  deliveryStreet: deliveryAddr.street,
  deliveryCity: deliveryAddr.city,
  deliveryPostCode: deliveryAddr.zipCode || deliveryAddr.postCode,
  deliveryPhone: deliveryAddr.phoneNumber,
  paymentType: paymentObj.type,
  paymentFinishedAt: paymentObj.finishedAt,
  paymentId: paymentObj.id,
    buyerNote,
    sellerNote,
    items,
    totalAmount,
    currency: currencyFallback,
    deliveryMethod,
    paymentStatus,
    isPaid,
    hasInvoice,
    invoiceCompanyName,
    invoiceStreet,
    invoiceStreetNumber,
    invoiceFlatNumber,
    invoicePostCode,
    invoiceCity,
    invoicePhone,
    invoiceTaxId,
  } as Order;
}

async function postOffersAction(path:string, offerIds:string[]):Promise<any>{
  const res = await fetch(path, { method:'POST', headers:{ 'Content-Type':'application/json', 'Accept':'application/json' }, credentials:'include', body: JSON.stringify({ offerIds }) });
  if (!res.ok) throw new Error('Akcja ofert nie powiodła się');
  return res.json();
}
export const endOffers = (offerIds:string[]) => postOffersAction('/api/offers/actions/end', offerIds);
export const setLastOffers = (offerIds:string[]) => postOffersAction('/api/offers/actions/set-last', offerIds);
export const resumeLastOffers = (offerIds:string[]) => postOffersAction('/api/offers/actions/resume-last', offerIds);

// Refund płatności za pozycje zwrócone w konkretnym zamówieniu (bez wysyłki/surcharges)
export async function refundPaymentItems(orderId: string, reason: string = 'REFUND', sellerComment?: string) {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/refund-payment-items`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
    credentials: 'include',
    body: JSON.stringify({ reason, sellerComment })
  });
  if (!res.ok) throw new Error('Refund payment request failed');
  return res.json();
}

export async function hasOrderRefund(orderId: string): Promise<boolean> {
  // Simple cache with TTL + in-flight deduplication to avoid spamming the backend
  const now = Date.now();
  const TTL = 60_000; // 60s cache is enough for UI rendering; invalidated on action
  // Initialize caches on first use
  // @ts-ignore
  if (!(hasOrderRefund as any)._cache) {
    // @ts-ignore
    (hasOrderRefund as any)._cache = new Map<string, { value: boolean; ts: number }>();
  }
  // @ts-ignore
  if (!(hasOrderRefund as any)._inflight) {
    // @ts-ignore
    (hasOrderRefund as any)._inflight = new Map<string, Promise<boolean>>();
  }
  // @ts-ignore
  const cache: Map<string, { value: boolean; ts: number }> = (hasOrderRefund as any)._cache;
  // @ts-ignore
  const inflight: Map<string, Promise<boolean>> = (hasOrderRefund as any)._inflight;

  const cached = cache.get(orderId);
  if (cached && (now - cached.ts) < TTL) {
    return cached.value;
  }
  const existing = inflight.get(orderId);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/refunds`, { credentials:'include' });
      if (!res.ok) throw new Error('Refunds fetch failed');
      const data = await res.json();
      const value = !!data?.hasAny;
      cache.set(orderId, { value, ts: Date.now() });
      return value;
    } finally {
      inflight.delete(orderId);
    }
  })();
  inflight.set(orderId, p);
  return p;
}

// Optional helper to invalidate refund cache (e.g., after creating a refund)
export function clearRefundCache(orderId?: string) {
  // @ts-ignore
  const cache: Map<string, { value: boolean; ts: number }> | undefined = (hasOrderRefund as any)._cache;
  // @ts-ignore
  const inflight: Map<string, Promise<boolean>> | undefined = (hasOrderRefund as any)._inflight;
  if (!cache && !inflight) return;
  if (orderId) {
    cache?.delete(orderId);
    inflight?.delete(orderId);
  } else {
    cache?.clear();
    inflight?.clear();
  }
}

// Commission refund (refund-claims): create claims for returned items in an order
export async function createCommissionRefund(orderId: string, reason: string = 'CUSTOMER_RETURN', sellerComment?: string) {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/refund-commission-claims`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
    credentials: 'include',
    body: JSON.stringify({ reason, sellerComment })
  });
  if (!res.ok) throw new Error('Refund commission request failed');
  return res.json();
}

// Cached check for existing commission refund claims for a given order
export async function hasCommissionClaim(orderId: string): Promise<boolean> {
  const now = Date.now();
  const TTL = 60_000;
  // @ts-ignore
  if (!(hasCommissionClaim as any)._cache) (hasCommissionClaim as any)._cache = new Map<string, { value: boolean; ts: number }>();
  // @ts-ignore
  if (!(hasCommissionClaim as any)._inflight) (hasCommissionClaim as any)._inflight = new Map<string, Promise<boolean>>();
  // @ts-ignore
  const cache: Map<string, { value: boolean; ts: number }> = (hasCommissionClaim as any)._cache;
  // @ts-ignore
  const inflight: Map<string, Promise<boolean>> = (hasCommissionClaim as any)._inflight;
  const cached = cache.get(orderId);
  if (cached && (now - cached.ts) < TTL) return cached.value;
  const existing = inflight.get(orderId);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/refund-claims`, { credentials:'include' });
      if (!res.ok) throw new Error('Refund-claims fetch failed');
      const data = await res.json();
      // Prefer explicit hasAny from backend; fallback to presence of any claims.
      // If claims include order.id, also try to match, but don't require it when server already scopes by order.
      let value = false;
      if (typeof data?.hasAny === 'boolean') {
        value = data.hasAny;
      } else if (Array.isArray(data?.claims)) {
        const hasClaims = data.claims.length > 0;
        const matchByOrder = data.claims.some((c:any) => String(c?.order?.id || '') === String(orderId));
        value = matchByOrder || hasClaims;
      }
      cache.set(orderId, { value, ts: Date.now() });
      return value;
    } finally {
      inflight.delete(orderId);
    }
  })();
  inflight.set(orderId, p);
  return p;
}

export function clearCommissionClaimCache(orderId?: string) {
  // @ts-ignore
  const cache: Map<string, { value: boolean; ts: number }> | undefined = (hasCommissionClaim as any)._cache;
  // @ts-ignore
  const inflight: Map<string, Promise<boolean>> | undefined = (hasCommissionClaim as any)._inflight;
  if (!cache && !inflight) return;
  if (orderId) { cache?.delete(orderId); inflight?.delete(orderId); }
  else { cache?.clear(); inflight?.clear(); }
}
