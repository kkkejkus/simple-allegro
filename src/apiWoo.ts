export interface WooOrder {
	id: number;
	number?: string;
	status: string;
	total: number;
	currency: string;
	date: string; // date_created
	store: string; // outdoorowe | sklepbastion
	deliveryMethod?: string | null;
	shippingTotalGross?: number;
	customerNote?: string; // customer_note z Woo (notatka klienta przy zamówieniu)
	lineItems?: {
		id: number;
		name: string;
		quantity: number;
		price: number;
		total: number;
		totalTax?: number;
		productId?: number;
		variationId?: number;
		sku?: string;
		image?: any;
		imageSrc?: string;
		model?: string;
	}[];
	billing?: any;
	datePaid?: string;
	metaData?: any[];
}

export interface WooStoreStatus {
	name: string;
	connected: boolean;
	baseUrl: string | null;
	verifiedAt: string | null;
	fromEnv: boolean;
}

export async function fetchWooStatuses(): Promise<WooStoreStatus[]> {
	const r = await fetch('http://localhost:3001/woo/status', { credentials: 'include' });
	if (!r.ok) throw new Error('Błąd statusów Woo');
	const d = await r.json();
	return d.stores || [];
}

export async function verifyWoo(store: string): Promise<any> {
	const r = await fetch(`http://localhost:3001/woo/verify?store=${encodeURIComponent(store)}`, { credentials: 'include' });
	const d = await r.json();
	if (!r.ok) throw new Error(d.error || 'Błąd weryfikacji Woo');
	return d;
}

export async function fetchWooOrders(store: string, days?: number): Promise<WooOrder[]> {
	const params = new URLSearchParams({ store });
	if (typeof days === 'number' && days > 0) params.set('days', String(days));
	const r = await fetch(`http://localhost:3001/woo/orders?${params.toString()}`, { credentials: 'include' });
	if (!r.ok) throw new Error('Błąd pobierania zamówień Woo');
	const d = await r.json();
	const orders = Array.isArray(d.orders) ? d.orders : [];
	return orders.map((o: any) => ({
		id: o.id,
		number: o.number,
		status: o.status,
		total: parseFloat(o.total || '0') || 0,
		currency: o.currency || 'PLN',
		date: o.date || o.date_created || o.dateCreated || new Date().toISOString(),
		store,
		deliveryMethod: o.deliveryMethod || null,
		shippingTotalGross: typeof o.shippingTotalGross === 'number' ? o.shippingTotalGross : undefined,
		customerNote: o.customerNote || o.customer_note || undefined,
		lineItems: o.lineItems || o.line_items || [],
		billing: o.billing,
		datePaid: o.datePaid || o.date_paid,
		metaData: o.metaData || o.meta_data || []
	}));
}

export async function setWooOne(store: string, productId: number, variationId?: number) {
	const r = await fetch('http://localhost:3001/woo/product/set-one', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ store, productId, variationId })
	});
	if (!r.ok) throw new Error('Błąd set-one');
	return r.json();
}

export async function endWooProduct(store: string, productId: number, variationId?: number) {
	const r = await fetch('http://localhost:3001/woo/product/end', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ store, productId, variationId })
	});
	if (!r.ok) throw new Error('Błąd end');
	return r.json();
}

export async function resumeWooProduct(store: string, productId: number, variationId?: number) {
	const r = await fetch('http://localhost:3001/woo/product/resume', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ store, productId, variationId })
	});
	if (!r.ok) throw new Error('Błąd resume');
	return r.json();
}

// Pobierz notatki zamówienia Woo (order notes)
export async function fetchWooOrderNotes(store: string, id: string | number): Promise<any[]> {
	const params = new URLSearchParams({ store, id: String(id) });
	const r = await fetch(`http://localhost:3001/woo/order-notes?${params.toString()}`, { credentials: 'include' });
	if (!r.ok) throw new Error('Błąd pobierania notatek Woo');
	const d = await r.json();
	return Array.isArray(d.notes) ? d.notes : [];
}
