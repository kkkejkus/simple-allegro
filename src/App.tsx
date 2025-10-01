import { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from 'react-dom';
import { fetchOrdersToday, fetchReturns, setOrderProcessing, fetchOrderById, hasOrderRefund, hasCommissionClaim } from "./apiAllegro";
import UnifiedOrders, { UnifiedOrder } from './components/UnifiedOrders';
import { fetchWooStatuses, verifyWoo, fetchWooOrders } from './apiWoo';
import type { Order, Return } from "./apiAllegro";

function App() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [returns, setReturns] = useState<Return[]>([]);
  const [loading, setLoading] = useState(true);
  // Nowe: osobne flagi ładowania
  const [loadingAllegro, setLoadingAllegro] = useState<boolean>(false);
  const [loadingSeller, setLoadingSeller] = useState<boolean>(false);
  const [loadingWooStores, setLoadingWooStores] = useState<Record<string, boolean>>({});
  const [refreshIn, setRefreshIn] = useState(120);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [now, setNow] = useState<Date>(new Date());
  const [showSent, setShowSent] = useState<boolean>(false);
  const [showCancelled, setShowCancelled] = useState<boolean>(false);
  const [showOnlyInvoice, setShowOnlyInvoice] = useState<boolean>(false);
  const [showOnlyReturns, setShowOnlyReturns] = useState<boolean>(false);
  const [showOnlyPendingReturns, setShowOnlyPendingReturns] = useState<boolean>(false);
  const [pendingReturnsMap, setPendingReturnsMap] = useState<Record<string, boolean>>({});
  const [pendingReturnsCounting, setPendingReturnsCounting] = useState(false);
  const [daysRange, setDaysRange] = useState<number>(7);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [updating, setUpdating] = useState<Set<string>>(new Set());
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [modalOfferId, setModalOfferId] = useState<string | null>(null);
  const [modalModel, setModalModel] = useState<string | null>(null);
  const [modalModelLoading, setModalModelLoading] = useState<boolean>(false);
  const [sellerLogin, setSellerLogin] = useState<string>('');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [wooStatuses, setWooStatuses] = useState<any[]>([]);
  const [wooOrders, setWooOrders] = useState<Record<string, any[]>>({ outdoorowe: [], sklepbastion: [] });
  const [autoRefreshPaused, setAutoRefreshPaused] = useState<boolean>(false);
  const wooProductCacheRef = useRef<Record<string, any>>({});
  const pendingWooProductFetchRef = useRef<Set<string>>(new Set());
  const [unifiedOrders, setUnifiedOrders] = useState<UnifiedOrder[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const handleLogin = () => { window.location.href = 'http://localhost:3001/auth/login'; };
  const timer = useRef<number | null>(null);
  const loadingGateRef = useRef<boolean>(false);
  const loadRunRef = useRef<number>(0);
  const allegroAugmentedRef = useRef<Order[]>([]);

  const loadData = async () => {
    if (loadingGateRef.current) { return; }
    loadingGateRef.current = true;
    const runId = (++loadRunRef.current);
    const T = (label: string) => `[UI#${runId}] ${label}`;
    try {
  setLoading(true);
  setLoadingAllegro(true);
  setLoadingSeller(true);
  setLoadingWooStores({});
      console.time(T('loadData total'));
      console.time(T('allegro+returns+seller+wooStatuses'));
      const [orders, returns, seller, wooStatusesInitial] = await Promise.all([
        (console.time(T('fetchOrdersToday')), fetchOrdersToday(daysRange).finally(()=>console.timeEnd(T('fetchOrdersToday')))),
        (console.time(T('fetchReturns')), fetchReturns(30).finally(()=>console.timeEnd(T('fetchReturns')))),
        (console.time(T('fetchSeller')), fetch('/api/seller', { credentials: 'include' }).then(r => r.ok ? r.json() : Promise.resolve({ login:'' })).finally(()=>console.timeEnd(T('fetchSeller')))),
        (console.time(T('fetchWooStatuses')), fetchWooStatuses().catch(()=>[]) .finally(()=>console.timeEnd(T('fetchWooStatuses'))))
      ]);
      console.timeEnd(T('allegro+returns+seller+wooStatuses'));
      setOrders(orders);
      setReturns(returns);
      if (seller?.login) setSellerLogin(seller.login);
  allegroAugmentedRef.current = orders; // baza do czasu dociągnięcia starszych
      setIsAuthenticated(true);
  setLoadingAllegro(false);
  setLoadingSeller(false);
      // Ustal statusy Woo (już pobrane równolegle)
      const st = Array.isArray(wooStatusesInitial) ? wooStatusesInitial : [];
      setWooStatuses(st);
  const collected: UnifiedOrder[] = [];
        // Allegro -> push
  const freshLogin = seller?.login || sellerLogin || 'konto';
        console.time(T('map Allegro -> unified'));
        orders.forEach(o => {
          const buyerObj: any = (o as any).buyerObject || (o as any).buyer && typeof (o as any).buyer === 'object' ? (o as any).buyer : null;
          const firstName = (o as any).buyerFirstName || buyerObj?.firstName;
          const lastName = (o as any).buyerLastName || buyerObj?.lastName;
          const buyerFullName = [firstName, lastName].filter(Boolean).join(' ') || (o as any).buyerFullName || undefined;
          const buyerLogin = (o as any).buyerLogin || buyerObj?.login || (typeof (o as any).buyer === 'string' ? undefined : (o as any).buyer?.login) || undefined;
          collected.push({
            ...o,
            id: o.id,
            platform: 'A',
            storeLabel: freshLogin,
            source: 'allegro',
            createdAt: o.createdAt,
            items: o.items,
            buyer: buyerLogin || (o as any).buyer || 'Nieznany',
            buyerFullName,
            buyerFirstName: firstName,
            buyerLastName: lastName,
            buyerLogin,
            buyerObject: buyerObj || (o as any).buyerObject,
            // Pre-renderowane etykiety dla uniknięcia migania
              buyerLabelBold: buyerLogin || (typeof (o as any).buyer === 'string' ? (o as any).buyer : undefined) || 'Nieznany',
            buyerLabelPlain: (() => {
              const full = [firstName, lastName].filter(Boolean).join(' ').trim();
                const bold = buyerLogin || (typeof (o as any).buyer === 'string' ? (o as any).buyer : undefined) || 'Nieznany';
              return full && full !== bold ? full : undefined;
            })()
          });
        });
        console.timeEnd(T('map Allegro -> unified'));
        // Wczesny render: pokaż Allegro od razu; starsze ze zwrotami dociągaj w tle
        console.time(T('sort unified (A only)'));
        setUnifiedOrders(collected.sort((a,b)=> new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        try {
          console.debug('[DEBUG unified Allegro map] sample', collected.slice(0,3).map(o=>({id:o.id,buyerLogin:o.buyerLogin,buyer:o.buyer,buyerFullName:o.buyerFullName, hasBuyerObject: !!(o as any).buyerObject})));
        } catch {}
        console.timeEnd(T('sort unified (A only)'));
        // Zachowaj poprzednie (stare) zamówienia Woo podczas odświeżania – efekt "stale-while-revalidate"
        const prevWooUnified = unifiedOrders.filter(u => u.platform==='W');
        if (prevWooUnified.length) {
          setUnifiedOrders(prev => {
            const merged = [...collected, ...prevWooUnified];
            return merged.sort((a,b)=> new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          });
        }
        setLoading(false);
        // Tło: dociągnij starsze zamówienia Allegro ze zwrotami z 30 dni (jeśli użytkownik i tak je zobaczy)
        (async () => {
          try {
            console.time(T('fetch older return orders'));
            const existingIds = new Set(orders.map(o => String(o.id)));
            const returnedOrderIds30 = Array.from(new Set((returns||[]).map(r => String((r as any).orderId)).filter(Boolean)));
            const missingIds = returnedOrderIds30.filter(id => !existingIds.has(id));
            const CONC = 8; // odrobinę większa współbieżność
            const olderFetched: Order[] = [];
            for (let i = 0; i < missingIds.length; i += CONC) {
              const chunk = missingIds.slice(i, i + CONC);
              const fetched = await Promise.all(chunk.map(async (id) => { try { return await fetchOrderById(id); } catch { return null; } }));
              fetched.filter(Boolean).forEach((o:any) => olderFetched.push(o as Order));
            }
            const uniqueOlder = olderFetched.filter(o => !existingIds.has(String(o.id)));
            // Zaktualizuj unified po zakończeniu dociągania
            allegroAugmentedRef.current = [...orders, ...uniqueOlder];
            setUnifiedOrders(prev => {
              const allegroUnified: UnifiedOrder[] = allegroAugmentedRef.current.map(o => {
                const buyerObj: any = (o as any).buyerObject || ((o as any).buyer && typeof (o as any).buyer === 'object' ? (o as any).buyer : null);
                const firstName = (o as any).buyerFirstName || buyerObj?.firstName;
                const lastName = (o as any).buyerLastName || buyerObj?.lastName;
                const buyerFullName = [firstName, lastName].filter(Boolean).join(' ') || (o as any).buyerFullName || undefined;
                const buyerLogin = (o as any).buyerLogin || buyerObj?.login || (typeof (o as any).buyer === 'string' ? undefined : (o as any).buyer?.login) || undefined;
                return {
                  ...o,
                  id: o.id,
                  platform: 'A',
                  storeLabel: freshLogin,
                  source: 'allegro',
                  createdAt: o.createdAt,
                  items: o.items,
                  buyer: buyerLogin || (o as any).buyer || 'Nieznany',
                  buyerFullName,
                  buyerFirstName: firstName,
                  buyerLastName: lastName,
                  buyerLogin,
                  buyerObject: buyerObj,
                  buyerLabelBold: buyerLogin || (typeof (o as any).buyer === 'string' ? (o as any).buyer : undefined) || 'Nieznany',
                  buyerLabelPlain: (() => {
                    const full = [firstName, lastName].filter(Boolean).join(' ').trim();
                    const bold = buyerLogin || (typeof (o as any).buyer === 'string' ? (o as any).buyer : undefined) || 'Nieznany';
                    return full && full !== bold ? full : undefined;
                  })()
                };
              });
              // Zachowaj Woo już dociągnięte
              const wooUnified: UnifiedOrder[] = [];
              Object.entries(wooOrders).forEach(([store, list]) => (list||[]).forEach((w:any) => wooUnified.push(mapWooToUnified({ ...w, store }))));
              const merged = [...allegroUnified, ...wooUnified];
              return merged.sort((a,b)=> new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            });
            console.timeEnd(T('fetch older return orders'));
          } catch { /* ignore */ }
        })();

        // 1) Sklepy wymagające verify -> po weryfikacji dociągnij zamówienia (asynchronicznie) (start jak najwcześniej)
        st.filter((s:any) => s.fromEnv && s.baseUrl && !s.verifiedAt).forEach((s:any) => {
          setLoadingWooStores(prev => ({ ...prev, [s.name]: true }));
          console.time(T(`verifyWoo ${s.name}`));
          verifyWoo(s.name)
            .then(v => {
              setWooStatuses(prev => prev.map(p => p.name===s.name ? { ...p, verifiedAt: v.verifiedAt, connected:true } : p));
              console.time(T(`fetchWooOrders ${s.name}`));
              return fetchWooOrders(s.name, daysRange).then(o => {
                setWooOrders(prev => {
                  const next = { ...prev, [s.name]: o };
                  const allegroBase = allegroAugmentedRef.current.length ? allegroAugmentedRef.current : orders;
                  setUnifiedOrders(prevUnified => mergeUnified(prevUnified, allegroBase, freshLogin, next, st));
                  return next;
                });
              }).finally(()=>{ console.timeEnd(T(`fetchWooOrders ${s.name}`)); setLoadingWooStores(prev => ({ ...prev, [s.name]: false })); });
            })
            .catch(()=>{})
            .finally(()=>console.timeEnd(T(`verifyWoo ${s.name}`)));
        });
        // 2) Połączone sklepy – pobierz równolegle i aktualizuj unified inkrementalnie (bez czekania na inne operacje)
        (async () => {
          const connectedStores = st.filter((s:any) => s.connected && s.verifiedAt);
            await Promise.all(connectedStores.map(async (s:any) => {
              try {
                setLoadingWooStores(prev => ({ ...prev, [s.name]: true }));
                console.time(T(`fetchWooOrders ${s.name}`));
                const o = await fetchWooOrders(s.name, daysRange);
                console.timeEnd(T(`fetchWooOrders ${s.name}`));
                setWooOrders(prev => {
                  const next = { ...prev, [s.name]: o };
                  const allegroBase = allegroAugmentedRef.current.length ? allegroAugmentedRef.current : orders;
                  setUnifiedOrders(prevUnified => mergeUnified(prevUnified, allegroBase, freshLogin, next, st));
                  return next;
                });
              } catch {} finally { setLoadingWooStores(prev => ({ ...prev, [s.name]: false })); }
            }));
        })();
      // koniec sekcji optymalizacji
      
    } catch (error) {
      if ((error as any).response?.status === 401) { setIsAuthenticated(false); }
      console.error('Błąd podczas ładowania danych:', error);
    } finally {
      setLoading(false);
      setRefreshIn(120);
      console.timeEnd(T('loadData total'));
      loadingGateRef.current = false;
    }
  };

  useEffect(() => {
    loadData();
  // już tylko jedno konto Allegro – brak odświeżania listy kont
    timer.current = window.setInterval(() => {
      setNow(new Date());
      setRefreshIn(prev => {
        if (autoRefreshPaused) return prev; // wstrzymane – licznik stoi
        if (prev === 1) { loadData(); return 120; }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [daysRange, autoRefreshPaused]);

  const formatDate = (s: string) => new Date(s).toLocaleString('pl-PL', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const formatMoney = (a?: number, c: string = 'PLN') => a === undefined ? '' : new Intl.NumberFormat('pl-PL', { style:'currency', currency:c }).format(a);

  const ratesRef = useRef<Record<string, number>>({ PLN:1 });
  const fetchingRateRef = useRef<Set<string>>(new Set());
  const [ratesVersion, setRatesVersion] = useState(0);

  const fetchRate = async (currency: string) => {
    currency = currency.toUpperCase();
    if (ratesRef.current[currency]) return ratesRef.current[currency];
    if (fetchingRateRef.current.has(currency)) return null;
    fetchingRateRef.current.add(currency);
    try {
      const nbp = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${currency}/?format=json`);
      if (nbp.ok) {
        const data = await nbp.json();
        const mid = data?.rates?.[0]?.mid;
        if (mid) { ratesRef.current[currency] = mid; return mid; }
      }
    } catch {}
    finally { fetchingRateRef.current.delete(currency); }
    return null;
  };

  const formatWithPln = (amount?: number, currency?: string) => {
    if (amount === undefined || !currency) return '';
    const main = formatMoney(amount, currency);
    if (currency.toUpperCase() === 'PLN') return main;
    const rate = ratesRef.current[currency.toUpperCase()];
    if (!rate) return main;
    return `${main} (${formatMoney(amount * rate, 'PLN')})`;
  };

  useEffect(() => {
    const currencies = new Set<string>();
    orders.forEach(o => { o.items?.forEach(it => { if (it.currency) currencies.add(it.currency.toUpperCase()); }); if (o.currency) currencies.add(o.currency.toUpperCase()); });
    const toFetch = Array.from(currencies).filter(c => c !== 'PLN' && !ratesRef.current[c]);
    if (!toFetch.length) return;
    let cancelled = false;
    (async () => { for (const cur of toFetch) { await fetchRate(cur); } if (!cancelled) setRatesVersion(v => v + 1); })();
    return () => { cancelled = true; };
  }, [orders]);

  const simplifyDeliveryMethod = (name?: string) => {
    if (!name) return '';
    const lower = name.toLowerCase();
    if (lower.includes('automaty paczkowe czechy') || (lower.includes('odbiór w punkcie czechy, inpost'))) return 'Czechy - Paczkomat InPost';
    if (lower.includes('kurier węgry, inpost')) return 'Węgry - Kurier InPost';
    if (lower.includes('kurier czechy, inpost')) return 'Czechy - Kurier InPost';
    if (lower.includes('kurier węgry, inpost')) return 'Węgry - Kurier InPost';
    if (lower.includes('minikurier24') && lower.includes('inpost')) return 'miniKurier InPost';
    if (lower.includes('paczkomat') || (lower.includes('paczkomaty') && lower.includes('inpost'))) return 'Paczkomat InPost';
    if (lower.includes('czechy - automaty paczkowe packeta, orlen')) return 'Czechy - Orlen Paczka';
    if (lower.includes('węgier - automaty paczkowe packeta, orlen')) return 'Węgry - Orlen Paczka';
    if (lower.includes('orlen')) return 'Orlen Paczka';
    if (lower.includes('dpd słowacja')) return 'Słowacja - DPD';
    if (lower.includes('dpd')) return 'DPD';
    if (lower.includes('dhl')) return 'DHL';
    if (lower.includes('ups')) return 'UPS';
    return name;
  };

  // Mapa: orderId -> data złożenia zwrotu (najwcześniejsza), do wyświetlenia w kartach
  const returnDateByOrderId: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {};
    (returns || []).forEach((r: any) => {
      const oid = r?.orderId ? String(r.orderId) : undefined;
      const created = r?.createdAt;
      if (!oid || !created) return;
      if (!map[oid]) { map[oid] = created; return; }
      const prev = new Date(map[oid]).getTime();
      const cur = new Date(created).getTime();
      if (isFinite(prev) && isFinite(cur) && cur < prev) map[oid] = created;
    });
    return map;
  }, [returns]);

  // NOWE: Mapa orderId -> referenceNumber (numer zwrotu) – jeśli wiele zwrotów do jednego zamówienia, weź pierwszy (najwcześniejszy)
  const returnReferenceByOrderId: Record<string, string> = useMemo(() => {
    const map: Record<string, { createdAt: string; ref: string }> = {};
    (returns || []).forEach((r: any) => {
      const oid = r?.orderId ? String(r.orderId) : undefined;
      const created = r?.createdAt;
      const ref = r?.referenceNumber;
      if (!oid || !created || !ref) return;
      if (!map[oid]) { map[oid] = { createdAt: created, ref }; return; }
      // Jeśli nowy zwrot jest wcześniejszy, podmień
      const prev = new Date(map[oid].createdAt).getTime();
      const cur = new Date(created).getTime();
      if (isFinite(prev) && isFinite(cur) && cur < prev) map[oid] = { createdAt: created, ref };
    });
    // Spłaszcz do string->string
    const flat: Record<string, string> = {};
    Object.keys(map).forEach(k => { flat[k] = map[k].ref; });
    return flat;
  }, [returns]);

  const downloadReceipt = (order: Order) => {
    try {
      const num = (n?: number) => n === undefined ? '' : n.toFixed(2).replace('.', ',');
      const toPln = (amount?: number, currency?: string) => {
        if (amount === undefined) return undefined;
        const cur = (currency || (order as any).currency || 'PLN').toString().toUpperCase();
        if (cur === 'PLN') return amount;
        const rate = ratesRef.current[cur];
        return rate ? amount * rate : amount; // jeśli brak kursu, nie zmieniamy
      };
      const lines: string[] = [];
      lines.push('Zebrane dane z zamówienia: (Allegro)');
      let idx = 1;
      order.items.filter(it => !it.isShipping).forEach(it => {
        lines.push(`\t${idx}. ${it.name}`);
        lines.push(`\t\tIlość: ${it.quantity}`);
        const pricePln = it.unitPrice !== undefined ? toPln(it.unitPrice, it.currency) : undefined;
        const price = pricePln !== undefined ? num(pricePln) : '';
        if (price) lines.push(`\t\tCena: ${price}`);
        idx++;
      });
      const shippingItem = order.items.find(i => i.isShipping);
      const shippingCostPln = shippingItem?.totalPrice !== undefined ? toPln(shippingItem.totalPrice, shippingItem.currency || (order as any).currency) : 0;
      lines.push(`\tKoszt wysyłki: ${num(shippingCostPln)}`);
      const triggerDownload = (data: string, filename: string) => {
        const blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
      };
      triggerDownload(lines.join('\n'), 'paragon.txt');
      if (order.hasInvoice) {
        const invoiceLines = [
          order.invoiceCompanyName || '',
          order.invoiceStreet || '',
          order.invoiceStreetNumber || '',
          order.invoiceFlatNumber || '',
          order.invoicePostCode || '',
          order.invoiceCity || '',
          order.invoicePhone || '',
          order.invoiceTaxId || '',
        ].join('\n');
        triggerDownload(invoiceLines, 'faktura.txt');
      }
    } catch (e) { console.error('Generowanie paragonu nie powiodło się', e); }
  };

  const downloadReceiptWoo = (u: UnifiedOrder) => {
    try {
      const num = (n?: number) => n === undefined ? '' : n.toFixed(2).replace('.', ',');
      const toPln = (amount?: number, currency?: string) => {
        if (amount === undefined) return undefined;
        const cur = (currency || u.currency || 'PLN').toString().toUpperCase();
        if (cur === 'PLN') return amount;
        const rate = ratesRef.current[cur];
        return rate ? amount * rate : amount;
      };
      const lines: string[] = [];
  lines.push('Zebrane dane z zamówienia: (WordPress)');
      let idx = 1;
      (u.items||[]).filter(it => !it.isShipping).forEach(it => {
        lines.push(`\t${idx}. ${it.name}`);
        lines.push(`\t\tIlość: ${it.quantity}`);
        const pricePln = it.unitPrice !== undefined ? toPln(it.unitPrice, it.currency) : undefined;
        const price = pricePln !== undefined ? num(pricePln) : '';
        if (price) lines.push(`\t\tCena: ${price}`);
        idx++;
      });
      const shipGross = typeof (u as any).shippingTotalGross === 'number' ? (u as any).shippingTotalGross : 0;
      const shipPln = toPln(shipGross, u.currency) || 0;
      lines.push(`\tKoszt wysyłki: ${num(shipPln)}`);
      // Brak generowania faktury – Woo nie generuje faktur
      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'paragon.txt'; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    } catch (e) { console.error('Generowanie paragonu Woo nie powiodło się', e); }
  };

  // Stare liczniki usunięte – teraz liczymy na podstawie filteredUnified niżej

  const handleSetProcessing = async (orderId: string) => {
    setUpdating(prev => new Set(prev).add(orderId));
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status:'PROCESSING' } : o));
    try { await setOrderProcessing(orderId); await loadData(); }
    catch { await loadData(); }
    finally { setUpdating(prev => { const n = new Set(prev); n.delete(orderId); return n; }); }
  };

  const openModalImage = (src?: string, offerId?: string, model?: string) => {
    if (!src) return;
    setModalImage(src);
    setModalOfferId(offerId || null);
    // Reset model i ewentualnie ustaw jeśli przekazany (Woo)
    setModalModel(null);
    if (model) {
      setModalModel(model);
    }
    // Pobieramy model z Allegro tylko jeśli to NIE jest pozycja Woo
    if (offerId && !offerId.startsWith('woo-item-')) {
      setModalModelLoading(true);
      fetch(`/api/offer/${offerId}/model`, { credentials:'include' })
        .then(r => r.json())
        .then(d => {
          // Nie nadpisuj modelu jeśli już ustawiony lokalnie (np. Woo)
          setModalModel(prev => prev || d?.value || null);
        })
        .catch(() => {})
        .finally(() => setModalModelLoading(false));
    } else {
      // Dla Woo nie czekamy na fetch – brak loading spinnera jeśli mamy model
      setModalModelLoading(false);
    }
    document.body.style.overflow = 'hidden';
  };
  const closeModalImage = () => { setModalImage(null); setModalOfferId(null); setModalModel(null); document.body.style.overflow=''; };

  useEffect(() => {
  (window as any).debugOffer = async (offerId: string) => { try { const r = await fetch(`/api/offer/${offerId}/debug`, { credentials:'include' }); const d = await r.json(); console.group(`DEBUG OFFER ${offerId}`); console.log(d); console.groupEnd(); return d; } catch(e){ console.error(e);} };
    (window as any).rawOffer = async (offerId: string) => { try { const r = await fetch(`/api/offer/${offerId}/raw`, { credentials:'include' }); const d = await r.json(); console.group(`RAW OFFER ${offerId}`); console.log(d); console.groupEnd(); return d; } catch(e){ console.error(e);} };
    (window as any).ownedOffer = async (offerId: string) => { try { const r = await fetch(`/api/offer/${offerId}/owned`, { credentials:'include' }); const d = await r.json(); console.group(`OWNED OFFER ${offerId}`); console.log(d); console.groupEnd(); return d; } catch(e){ console.error(e);} };
    (window as any).offerParams = async (offerId: string) => { try { const r = await fetch(`/api/offer/${offerId}/params`, { credentials:'include' }); const d = await r.json(); console.group(`PARAMS OFFER ${offerId}`); console.table(d?.combinedParameters || []); console.groupEnd(); return d; } catch(e){ console.error(e);} };
    (window as any).updateOfferProduct = async (offerId: string, productId: string, account?: string) => { try { const r = await fetch(`/api/offer/${offerId}/product-set`, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ productId, account }) }); const d = await r.json(); console.group(`UPDATE PRODUCTSET ${offerId}`); console.log(d); console.groupEnd(); return d; } catch(e){ console.error(e);} };
    // NOWE: debug statusu zwrotu zapłaty dla zamówienia (Allegro)
    (window as any).debugOrderRefund = async (orderId: string) => {
      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(orderId)}/refunds`, { credentials: 'include' });
        const d = await r.json();
        const list = Array.isArray((d||{}).refunds) ? d.refunds : (Array.isArray(d) ? d : []);
        console.group(`DEBUG REFUNDS ${orderId}`);
        console.log('hasAny:', (d as any)?.hasAny ?? (list.length > 0));
        console.log('count:', list.length);
        if (list.length) {
          const rows = list.map((x:any) => ({
            id: x.id,
            status: x.status || x.state,
            amount: (x.amount?.amount ?? x.amount) ?? null,
            currency: x.amount?.currency || x.currency || 'PLN',
            createdAt: x.createdAt || x.creationDate || x.created || x.updatedAt || null,
          }));
          console.table(rows);
        } else {
          console.log('Brak refundów lub niepoprawna odpowiedź. Odpowiedź:', d);
        }
        console.groupEnd();
        return d;
      } catch (e) {
        console.error('debugOrderRefund error', e);
        return null;
      }
    };
    // NOWE: debug statusu zwrotu prowizji dla zamówienia (Allegro)
  (window as any).debugCommissionClaim = async (orderId: string) => {
      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(orderId)}/refund-claims?all=1`, { credentials: 'include' });
        const d = await r.json();
        const list = Array.isArray((d||{}).claims) ? d.claims : (Array.isArray(d) ? d : []);
        console.group(`DEBUG COMMISSION CLAIMS ${orderId}`);
        console.log('hasAny:', (d as any)?.hasAny ?? (list.length > 0));
        console.log('count:', list.length, 'offersChecked:', (d as any)?.offersChecked ?? 'n/a', 'scope:', (d as any)?.scope ?? 'n/a');
        if (list.length) {
          const rows = list.map((x:any) => ({
            id: x.id,
            status: x.status || x.state,
            createdAt: x.createdAt || x.creationDate || x.created || null,
            orderId: x.order?.id,
            lineItems: Array.isArray(x.lineItems) ? x.lineItems.length : 0,
          }));
          console.table(rows);
        } else {
          console.log('Brak refund-claims lub niepoprawna odpowiedź. Odpowiedź:', d);
        }
        console.groupEnd();
        return d;
      } catch (e) {
        console.error('debugCommissionClaim error', e);
        return null;
      }
    };
    // NOWE: debug pojedynczego zamówienia
    (window as any).debugOrder = async (orderId: string) => {
      try {
        const r = await fetch(`/api/orders/${orderId}`, { credentials: 'include' });
        const d = await r.json();
        console.group(`DEBUG ORDER ${orderId}`);
        console.log(d.order || d);
        if (d.order) {
          console.log('Line items:', d.order.lineItems?.length);
          (d.order.lineItems || []).forEach((li: any, i: number) => {
            console.log(`#${i+1}`, li.offer?.id, li.offer?.name, li.quantity, li.offer?.image);
          });
          console.log('messageToSeller (kupujący):', d.order.messageToSeller || d.order.buyer?.messageToSeller || null);
          console.log('note (sprzedający):', d.order.note?.text || d.order.note || null);
        }
        console.groupEnd();
        return d.order || d;
      } catch (e) { console.error('debugOrder error', e); }
    };
    (window as any).debugWooOrder = async (store: string, id: string|number) => {
      try {
        const r = await fetch(`http://localhost:3001/woo/order/${id}?store=${encodeURIComponent(store)}`, { credentials:'include' });
        const d = await r.json();
        console.group(`DEBUG WOO ORDER ${store} #${id}`);
        console.log(d.order || d);
        if (d.order) {
          console.log('line_items:', (d.order.line_items||[]).length);
          (d.order.line_items||[]).forEach((li: any, i: number) => {
            console.log(`#${i+1}`, li.id, li.name, 'qty:', li.quantity, 'product_id:', li.product_id, 'image?', li.image?.src || null);
          });
          console.log('billing:', d.order.billing);
          console.log('meta_data sample:', (d.order.meta_data||[]).slice(0,5));
          console.log('date_paid:', d.order.date_paid);
        }
        console.groupEnd();
        return d.order || d;
      } catch(e) { console.error('debugWooOrder error', e); }
    };
  }, []);

  // Debug: ostatni zwrot (najnowszy)
  useEffect(() => {
  (window as any).debugLastReturn = async (opts?: { withinDays?: number; onlyCurrentOrders?: boolean; allowFallback?: boolean }) => {
      try {
  const withinDays = Number.isFinite(opts?.withinDays as any) ? Math.max(1, Number(opts?.withinDays)) : 120; // domyślnie 120 dni
        const onlyCurrentOrders = opts?.onlyCurrentOrders !== undefined ? !!opts.onlyCurrentOrders : true; // domyślnie tylko bieżące zamówienia
  const allowFallback = !!opts?.allowFallback; // gdy true, wróci do 'valid' jeśli nie ma recent

  const r = await fetch(`/api/returns${withinDays ? `?days=${encodeURIComponent(withinDays)}` : ''}`, { credentials: 'include' });
        const d = await r.json();
        const arr: any[] = Array.isArray(d?.returns) ? d.returns : (Array.isArray(d) ? d : []);
        if (!arr.length) { console.warn('Brak zwrotów.'); return null; }

        const parseCreated = (x: any) => x?.createdAt || x?.created_at || x?.creationDate || x?.created || '';
        const getTs = (x:any) => {
          const t = Date.parse(parseCreated(x));
          return Number.isFinite(t) ? t : NaN;
        };

        const now = Date.now();
        const maxAgeMs = withinDays * 24 * 60 * 60 * 1000;

        // Filtr 1: poprawne daty i w ramach withinDays
  const valid = arr.filter(x => Number.isFinite(getTs(x)));
  const recent = valid.filter(x => (now - (getTs(x) as number)) <= maxAgeMs);

        // Filtr 2: przypisane do zamówień obecnych na liście (według bieżącego zakresu daysRange)
        const orderIdsSet = new Set(orders.map(o => String(o.id)));
        const scoped = onlyCurrentOrders ? recent.filter(x => orderIdsSet.has(String(x.orderId))) : recent;

  const poolBase = scoped.length ? scoped : (recent.length ? recent : []);
  const pool = (poolBase.length ? poolBase : (allowFallback ? valid : []));

        if (!pool.length) {
          console.warn('Brak zwrotów po filtrach (withinDays/onlyCurrentOrders). Nie zastosowano fallbacku do bardzo starych zwrotów.');
          return null;
        }

        // Wybór najnowszego: createdAt DESC, a przy remisie po ID malejąco
        const newest = pool.reduce((best:any, cur:any) => {
          if (!best) return cur;
          const tb = getTs(best) as number; const tc = getTs(cur) as number;
          if (tc > tb) return cur;
          if (tc < tb) return best;
          const nb = Number(best.id), nc = Number(cur.id);
          if (Number.isFinite(nc) && Number.isFinite(nb)) return nc > nb ? cur : best;
          return String(cur.id).localeCompare(String(best.id)) > 0 ? cur : best;
        }, null as any);

        const order = orders.find(o => String(o.id) === String(newest.orderId)) || null;
        const ids = new Set<string>(Array.isArray(newest.itemsOfferIds) ? newest.itemsOfferIds.map((x:any)=>String(x)) : []);
        const matchedItems = (order?.items||[]).filter(it => it.id && ids.has(String(it.id)));

        console.group('DEBUG LAST RETURN');
        console.log('Ustawienia:', { withinDays, onlyCurrentOrders });
  console.log('Ilość zwrotów:', { total: arr.length, valid: valid.length, recent: recent.length, scoped: scoped.length, usedPool: pool.length, usedFallbackToValid: (!poolBase.length && allowFallback) });
        console.log('Najświeższe (top 5) po createdAt:',
          [...pool]
            .sort((a,b) => (getTs(b) as number) - (getTs(a) as number))
            .slice(0,5)
            .map(x => ({ id: x.id, orderId: x.orderId, createdAt: parseCreated(x), status: x.status }))
        );
        console.log('Wybrany zwrot:', { id: newest.id, orderId: newest.orderId, createdAt: parseCreated(newest), status: newest.status, itemsCount: (newest.itemsOfferIds||[]).length });
        if (onlyCurrentOrders && !order) {
          console.warn('Wybrany zwrot nie ma odpowiadającego zamówienia w bieżącej liście (daysRange). Rozważ ustawienie { onlyCurrentOrders: false }.');
        }
        if (order) {
          console.group('ORDER');
          console.log({ id: order.id, status: order.status, createdAt: order.createdAt, buyer: order.buyer, buyerFullName: order.buyerFullName });
          console.groupEnd();
        }
        console.group('ITEMS MATCH');
        if (matchedItems.length) {
          console.table(matchedItems.map(m => ({ offerId: m.id, name: m.name, qty: m.quantity })));
        } else {
          console.log('Brak dopasowanych pozycji.');
        }
        console.groupEnd();
        console.groupEnd();
        return { last: newest, order, matchedItems };
      } catch (e) {
        console.error('debugLastReturn error', e);
        return null;
      }
    };
  }, [orders]);

  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModalImage(); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, []);

  // Pokazywanie przycisku przewijania do góry
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      setShowScrollTop(y > 140);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () => {
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { window.scrollTo(0,0); }
  };

  const manualRefresh = async () => { await loadData(); };
  const toggleAutoRefresh = () => {
    setAutoRefreshPaused(prev => {
      const next = !prev;
      if (!next) { loadData(); }
      return next;
    });
  };

  // Zbierz mapę: orderId -> Set(offerId) dla zwrotów (tylko Allegro)
  const returnedOfferIdsByOrder: Record<string, Set<string>> = (() => {
    const map: Record<string, Set<string>> = {};
    (returns || []).forEach(r => {
      const oid = String((r as any).orderId || '');
      if (!oid) return;
      const ids: string[] = Array.isArray((r as any).itemsOfferIds) ? (r as any).itemsOfferIds.map((x:any)=>String(x)) : [];
      if (!ids.length) return;
      if (!map[oid]) map[oid] = new Set();
      ids.forEach(id => map[oid].add(id));
    });
    return map;
  })();
  const returnedOrderIds: Set<string> = new Set<string>((returns || []).map(r => String((r as any).orderId)).filter(Boolean));

  // Jednolity filtr dla widoku – używany i do listy i do liczników w nagłówku
  const filteredUnified = unifiedOrders.filter(o => {
    const status = (o.status||'').toLowerCase();
    const isSentLike = (o.platform==='A' && o.status==='SENT') || (o.platform==='W' && status==='completed');
    const isCancelledLike = ['cancelled','canceled','cancelled','refunded','failed','cancelled','canceled'].includes(status) || (o.status==='CANCELLED'||o.status==='CANCELED');
    // Filtr źródła: wielokrotny wybór (A / W:outdoorowe / W:sklepbastion)
    if (selectedSources.size > 0) {
      const key = o.platform === 'A' ? 'A' : `W:${o.wooStore}`;
      if (!selectedSources.has(key)) return false;
    }
    // Filtrowanie zwrotów: tylko zamówienia Allegro, które występują w returnedOrderIds
    if (showOnlyReturns) {
      const isReturn = (o.platform==='A' && returnedOrderIds.has(o.id));
      if (!isReturn) return false;
    }
    if (showOnlyPendingReturns) {
      // tylko Allegro i tylko takie które MAJĄ zwrot i są pending
      const isReturn = (o.platform==='A' && returnedOrderIds.has(o.id));
      if (!isReturn) return false;
      if (!pendingReturnsMap[o.id]) return false;
    }
    if (isSentLike && !showSent) return false;
    if (isCancelledLike && !showCancelled) return false;
    if (showOnlyInvoice && !o.hasInvoice) return false;
    return true;
  });

  // Liczniki + rozbicie na konta dla 3 widżetów (na podstawie przefiltrowanej listy)
  const accInit = { allegro: 0, outdoorowe: 0, sklepbastion: 0 } as Record<'allegro'|'outdoorowe'|'sklepbastion', number>;
  const procBy = { ...accInit };
  const sentBy = { ...accInit };
  const retBy = { ...accInit };
  for (const o of filteredUnified) {
    const status = (o.status||'').toLowerCase();
    const acc: 'allegro'|'outdoorowe'|'sklepbastion' = (o.platform==='A') ? 'allegro' : (o.wooStore === 'sklepbastion' ? 'sklepbastion' : 'outdoorowe');
    const isProc = (o.platform==='A' && (o.status==='PROCESSING' || o.status==='NEW')) || (o.platform==='W' && (status==='processing' || status==='on-hold'));
    const isSent = (o.platform==='A' && o.status==='SENT') || (o.platform==='W' && status==='completed');
    const isReturn = (o.platform==='A' && returnedOrderIds.has(o.id));
    if (isProc) procBy[acc]++;
    if (isSent) sentBy[acc]++;
    if (isReturn) retBy[acc]++;
  }
  const processingCombined = procBy.allegro + procBy.outdoorowe + procBy.sklepbastion;
  const sentCombined = sentBy.allegro + sentBy.outdoorowe + sentBy.sklepbastion;
  const returnsCombined = retBy.allegro + retBy.outdoorowe + retBy.sklepbastion; // Woo będzie 0
  const tip = (by: typeof accInit) => {
    const a = `Allegro (${(sellerLogin || 'konto').toLowerCase()}): ${by.allegro}`;
    const w1 = `Woo (outdoorowe): ${by.outdoorowe}`;
    const w2 = `Woo (sklepbastion): ${by.sklepbastion}`;
    return `${a}\n${w1}\n${w2}`;
  };

  // Wariant liczników wg filtra "Wyniki z ostatnich dni" + wybrane źródła (ignoruje inne przełączniki widoku)
  const cutoffTs = Date.now() - (daysRange * 24 * 60 * 60 * 1000);
  const daysScoped = unifiedOrders.filter(o => {
    if (selectedSources.size > 0) {
      const key = o.platform === 'A' ? 'A' : `W:${o.wooStore}`;
      if (!selectedSources.has(key)) return false;
    }
    // Tylko w obrębie wybranego zakresu dni
    const ts = Date.parse(o.createdAt);
    return Number.isFinite(ts) ? (ts >= cutoffTs) : true;
  });
  const sentByDays = { ...accInit };
  for (const o of daysScoped) {
    const status = (o.status||'').toLowerCase();
    const acc: 'allegro'|'outdoorowe'|'sklepbastion' = (o.platform==='A') ? 'allegro' : (o.wooStore === 'sklepbastion' ? 'sklepbastion' : 'outdoorowe');
    const isSent = (o.platform==='A' && o.status==='SENT') || (o.platform==='W' && status==='completed');
    if (isSent) sentByDays[acc]++;
  }
  // (pozostawiona jedna deklaracja sentCombinedDays niżej)

  // Zwroty wg dni: bazujemy na liście returns (po dacie zwrotu), licząc unikalne orderId; respektujemy filtr źródeł (A)
  const retByDays = { ...accInit };
  const cutoffMs = daysRange * 24 * 60 * 60 * 1000;
  const sinceTs = Date.now() - cutoffMs;
  const parseRC = (x:any) => x?.createdAt || x?.created_at || x?.creationDate || x?.created || '';
  const getRTs = (x:any) => { const t = Date.parse(parseRC(x)); return Number.isFinite(t) ? t : NaN; };
  const returnsDaysOrderIds = Array.from(new Set((returns||[])
    .filter(r => Number.isFinite(getRTs(r)) && (getRTs(r) as number) >= sinceTs)
    .map(r => String((r as any).orderId))
    .filter(Boolean)));
  retByDays.allegro = returnsDaysOrderIds.length; // tylko Allegro; Woo = 0
  const sentCombinedDays = sentByDays.allegro + sentByDays.outdoorowe + sentByDays.sklepbastion;
  const returnsCombinedDays = retByDays.allegro + retByDays.outdoorowe + retByDays.sklepbastion;

  // Zwroty 30-dniowe: niezależne od filtru dni (returns pobierane i tak z 30 dni)
  const returns30OrderIds = Array.from(new Set((returns || [])
    .map(r => String((r as any).orderId))
    .filter(Boolean)));
  const retBy30 = { allegro: returns30OrderIds.length, outdoorowe: 0, sklepbastion: 0 } as typeof accInit;
  const returnsCombined30 = retBy30.allegro + retBy30.outdoorowe + retBy30.sklepbastion;

  // NOWE: Czas od ostatniego zamówienia oraz zwrotu
  const lastOrderAgeLabel = useMemo(() => {
    if (!unifiedOrders.length) return 'brak';
    const newest = unifiedOrders.reduce((a,b)=> new Date(a.createdAt).getTime() > new Date(b.createdAt).getTime() ? a : b);
    const ts = Date.parse(newest.createdAt);
    if (!Number.isFinite(ts)) return 'brak';
    const diff = Date.now() - ts;
    if (diff < 0) return '0s';
    const s = Math.floor(diff / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts: string[] = [];
    if (h) parts.push(`${h}h`);
    if (m || h) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
  }, [unifiedOrders, now]);

  const lastReturnAgeLabel = useMemo(() => {
    if (!returns.length) return 'brak';
    const newest = returns.reduce((a,b)=> {
      const ta = Date.parse((a as any).createdAt || (a as any).creationDate || (a as any).created || '');
      const tb = Date.parse((b as any).createdAt || (b as any).creationDate || (b as any).created || '');
      return (tb > ta) ? b : a;
    });
    const raw = (newest as any).createdAt || (newest as any).creationDate || (newest as any).created || '';
    const ts = Date.parse(raw);
    if (!Number.isFinite(ts)) return 'brak';
    const diff = Date.now() - ts;
    if (diff < 0) return '0s';
    const s = Math.floor(diff / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts: string[] = [];
    if (h) parts.push(`${h}h`);
    if (m || h) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
  }, [returns, now]);

  // Pending zwroty 30-dniowe (Allegro z returns30OrderIds bez refundu wpłaty i bez zwrotu prowizji)
  const [pendingReturns30Map, setPendingReturns30Map] = useState<Record<string, boolean>>({});
  const [pendingReturnsCounting30, setPendingReturnsCounting30] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!returns30OrderIds.length) { setPendingReturns30Map({}); return; }
      setPendingReturnsCounting30(true);
      const next: Record<string, boolean> = {};
      const CONC = 6;
      for (let i = 0; i < returns30OrderIds.length; i += CONC) {
        const chunk = returns30OrderIds.slice(i, i + CONC);
        const results = await Promise.all(chunk.map(async (id) => {
          try {
            const [paid, comm] = await Promise.all([
              hasOrderRefund(id),
              hasCommissionClaim(id)
            ]);
            return { id, pending: !(paid || comm) };
          } catch {
            return { id, pending: true };
          }
        }));
        results.forEach(r => { next[r.id] = r.pending; });
        if (cancelled) return;
      }
      if (!cancelled) setPendingReturns30Map(next);
      setPendingReturnsCounting30(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(returns30OrderIds)]);
  // Zwroty do zrealizowania (na podstawie tego co widoczne): Allegro z returnedOrderIds, ale bez refundu wpłaty i bez zwrotu prowizji
  const visibleAllegroWithReturn = filteredUnified.filter(o => o.platform==='A' && returnedOrderIds.has(o.id));
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPendingReturnsCounting(true);
      const next: Record<string, boolean> = {};
      // Limit współbieżności, żeby nie zalać backendu – oraz korzystamy z TTL cache po stronie klienta/serwera
      const CONC = 6;
      for (let i = 0; i < visibleAllegroWithReturn.length; i += CONC) {
        const chunk = visibleAllegroWithReturn.slice(i, i + CONC);
        const results = await Promise.all(chunk.map(async (o) => {
          try {
            const [paid, comm] = await Promise.all([
              hasOrderRefund(o.id),
              hasCommissionClaim(o.id)
            ]);
            return { id: o.id, pending: !(paid || comm) };
          } catch {
            return { id: o.id, pending: true }; // w razie błędu – zachowawczo do zrobienia
          }
        }));
        results.forEach(r => { next[r.id] = r.pending; });
        if (cancelled) return;
      }
      if (!cancelled) setPendingReturnsMap(next);
      setPendingReturnsCounting(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(visibleAllegroWithReturn.map(o=>o.id))]);

  // Wspólny znacznik ładowania dla nagłówkowych sum (gdy trwa ładowanie któregokolwiek źródła)
  const wooLoadingCount = Object.values(loadingWooStores).filter(Boolean).length;
  const headerAnyLoading = loadingAllegro || loadingSeller || wooLoadingCount > 0 || loading;

  // Fallback modeli Woo: dociąganie atrybutów produktu gdy model nie został jeszcze ustalony
  useEffect(() => {
    const wooItemsMissing = unifiedOrders
      .filter(o => o.platform === 'W')
      .flatMap(o => (o.items || []).map(it => ({ orderId: o.id, store: (o as any).wooStore, item: it })))
      .filter(rec => !rec.item.model && (rec.item as any).productId);
    if (!wooItemsMissing.length) return;
    let cancelled = false;
    (async () => {
      for (const rec of wooItemsMissing) {
        const productId = (rec.item as any).productId;
        const key = (rec.store || '') + ':' + productId;
        if (!key) continue;
        const applyModel = (modelVal: string) => {
          if (!modelVal || cancelled) return;
            setUnifiedOrders(prev => prev.map(o => {
              if (o.id !== rec.orderId) return o;
              return { ...o, items: (o.items || []).map(it => it.id === rec.item.id ? ({ ...it, model: modelVal }) : it) };
            }));
        };
        // Z cache
        if (wooProductCacheRef.current[key]) {
          const prod = wooProductCacheRef.current[key];
          const attrs = prod?.attributes || [];
          const found = attrs.find((a:any) => {
            const n = (a?.name || '').toString().toLowerCase();
            const s = (a?.slug || '').toString().toLowerCase();
            return n.includes('model') || s.includes('model');
          });
          if (found) {
            const val = Array.isArray(found.options) ? found.options.join(', ') : (found.option || found.options);
            const modelVal = typeof val === 'string' ? val : (val != null ? String(val) : undefined);
            if (modelVal) applyModel(modelVal);
          }
          continue;
        }
        // Already fetching
        if (pendingWooProductFetchRef.current.has(key)) continue;
        pendingWooProductFetchRef.current.add(key);
        try {
          const r = await fetch(`http://localhost:3001/woo/product/${productId}?store=${encodeURIComponent(rec.store || '')}`, { credentials: 'include' });
          if (r.ok) {
            const d = await r.json();
            wooProductCacheRef.current[key] = d.product || d;
            const prod = wooProductCacheRef.current[key];
            const attrs = prod?.attributes || [];
            const found = attrs.find((a:any) => {
              const n = (a?.name || '').toString().toLowerCase();
              const s = (a?.slug || '').toString().toLowerCase();
              return n.includes('model') || s.includes('model');
            });
            if (found) {
              const val = Array.isArray(found.options) ? found.options.join(', ') : (found.option || found.options);
              const modelVal = typeof val === 'string' ? val : (val != null ? String(val) : undefined);
              if (modelVal) applyModel(modelVal);
            }
          }
        } catch {}
        finally { pendingWooProductFetchRef.current.delete(key); }
        if (cancelled) break;
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unifiedOrders]);

  return (
    <div className="container py-3">
      {isAuthenticated && (
        <section style={{marginTop:'-16px' }}>
          {/* Top-left absolute: data i godzina */}
          <div className="page-info page-info-topleft">
            <div className="small text-muted" style={{ textAlign:'left', backdropFilter: 'blur(1.5px)', backgroundColor:'rgba(247,247,247,0.5)', borderRadius:4 }}>
              <div><b>🕰️{now.toLocaleTimeString('pl-PL', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}</b></div>
              <div style={{ marginTop:'-8px' }}>🗓️{now.toLocaleDateString('pl-PL', { day:'2-digit', month:'2-digit', year:'numeric' })}</div>
            </div>
          </div>
          {/* Top-right absolute: odświeżanie i połączone konta */}
          <div className="page-info page-info-topright">
            <div className="small text-muted" style={{ textAlign:'right', backdropFilter: 'blur(1.5px)', backgroundColor:'rgba(247,247,247,0.5)', borderRadius:4 }}>
              <div style={{marginBottom:'2px', display:'flex', alignItems:'center', justifyContent:'flex-end', gap:6}}>
                <span>Odświeżanie za: <b>{autoRefreshPaused ? 'Wstrzymane' : `${refreshIn}s`}</b></span>
                <button
                  className="btn btn-sm btn-outline-secondary filter-btn refresh-btn"
                  onClick={manualRefresh}
                  title="Odśwież teraz"
                >↺</button>
                <button
                  className="btn btn-sm btn-outline-secondary filter-btn refresh-btn"
                  onClick={toggleAutoRefresh}
                  title={autoRefreshPaused ? 'Wznów odświeżanie' : 'Wstrzymaj odświeżanie'}
                  style={autoRefreshPaused ? {} : {padding:'3px 5px 5px 6px'}}
                >{autoRefreshPaused ? '⏸︎' : '⏯︎'}</button>
              </div>
              <div><b><u>Połączenia:</u></b></div>
              <div style={{ marginTop:'-4px' }}>
                <a
                  href="https://salescenter.allegro.com/orders"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Przejdź do zamówień bezpośrednio na Allegro"
                  style={{ textDecoration:'none', color:'inherit', display:'inline-block' }}
                >
                  <span style={{color: '#f1821a', fontWeight: 'bold'}}>A</span>
                  {`${(sellerLogin || 'konto').toLowerCase()} ${isAuthenticated ? '✅' : '🚫'}`}
                </a>
              </div>
              {['outdoorowe','sklepbastion'].map((s) => {
                const ws = (wooStatuses||[]).find((x:any)=>x?.name===s);
                const ok = !!(ws && ws.connected && ws.verifiedAt);
                const href = s === 'outdoorowe'
                  ? 'https://outdoorowe.pl/wp-admin/edit.php?post_type=shop_order'
                  : 'https://sklepbastion.pl/wp-admin/edit.php?post_type=shop_order';
                const title = `Przejdź do zamówień bezpośrednio w panelu Woo (${s})`;
                return (
                  <div key={`conn-${s}`} className="text-muted" style={{ marginTop:'-4px' }}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={title}
                      style={{ textDecoration:'none', color:'inherit', display:'inline-block' }}
                    >
                      <span style={{color: '#6e57d4', fontWeight: 'bold'}}>W</span>
                      {`${s} ${ok ? '✅' : '🚫'}`}
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="filters-bar">
            <div className="filters-top" style={{gridTemplateColumns: '1fr 1fr'}}>
              {/* Blok: Zamówienia */}
              <div className="stat-box" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                <div className="text-muted" style={{gridColumn:'1 / -1', textAlign:'center', fontWeight:600, marginBottom:'-4px'}}>📦 Zamówienia 📦</div>
                <div className="d-flex align-items-center justify-content-center gap-2">
                  <span className="badge bg-warning text-dark rounded-pill px-2 py-1">{headerAnyLoading ? '…' : processingCombined}</span>
                  <span className="text-muted small">W realizacji</span>
                  <span className="text-muted small question-mark" title={`Dane z ostatnich ${daysRange} dni\n\n${tip(procBy)}`}>❔</span>
                </div>
                <div className="d-flex align-items-center justify-content-center gap-2">
                  <span className="badge bg-success rounded-pill px-2 py-1">{headerAnyLoading ? '…' : sentCombinedDays}</span>
                  <span className="text-muted small">Wysłane</span>
                  <span className="text-muted small question-mark" title={`Dane z ostatnich ${daysRange} dni\n\n${tip(sentByDays)}`}>❔</span>
                </div>
                <div className="d-flex align-items-center justify-content-center gap-2" style={{gridColumn:'1 / -1', marginTop:'-4px'}}>
                  <span className="text-muted small">Najnowsze zamówienie zostało złożone</span>
                  <span className="badge bg-primary rounded-pill px-2 py-1" title="Czas od pojawienia się ostatniego zamówienia">{lastOrderAgeLabel} temu</span>
                </div>
              </div>
              {/* Blok: Zwroty */}
              <div className="stat-box" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                <div className="text-muted" style={{gridColumn:'1 / -1', textAlign:'center', fontWeight:600, marginBottom:'-4px'}}>🔁 Zwroty 🔁</div>
                <div className="d-flex align-items-center justify-content-center gap-2">
                  <span className="badge bg-danger rounded-pill px-2 py-1">{pendingReturnsCounting30 ? '…' : Object.values(pendingReturns30Map).filter(Boolean).length}</span>
                  <span className="text-muted small">Do zrealizowania</span>
                  <span className="text-muted small question-mark" title={`Dane z ostatnich 30 dni\n\n${tip({ allegro: Object.entries(pendingReturns30Map).filter(([id,v])=>v).length, outdoorowe:0, sklepbastion:0 })}`}>❔</span>
                </div>
                <div className="d-flex align-items-center justify-content-center gap-2">
                  <span className="badge bg-dark rounded-pill px-2 py-1">{headerAnyLoading ? '…' : returnsCombined30}</span>
                  <span className="text-muted small">Zgłoszone</span>
                  <span className="text-muted small question-mark" title={`Dane z ostatnich 30 dni\n\n${tip(retBy30)}`}>❔</span>
                </div>
                <div className="d-flex align-items-center justify-content-center gap-2" style={{gridColumn:'1 / -1', marginTop:'-4px'}}>
                  <span className="text-muted small">Najnowsze zgłoszenie zwrotu pojawiło się</span>
                  <span className="badge bg-secondary rounded-pill px-2 py-1" title="Czas od pojawienia się ostatniego zgłoszenia zwrotu">{lastReturnAgeLabel} temu</span>
                </div>
              </div>
            </div>
            <div className="filters-bottom d-flex align-items-center flex-wrap gap-3">
              <div className="d-flex gap-2">
                <label className="mb-0 text-muted" style={{marginTop:'5px'}}>Pokaż:</label>
                <input id="toggleSent" type="checkbox" className="btn-check" autoComplete="off" checked={showSent} onChange={e=>setShowSent(e.target.checked)} />
                <label htmlFor="toggleSent" className="btn btn-sm btn-outline-secondary filter-btn">wysyłane</label>
                <input id="toggleCancelled" type="checkbox" className="btn-check" autoComplete="off" checked={showCancelled} onChange={e=>setShowCancelled(e.target.checked)} />
                <label htmlFor="toggleCancelled" className="btn btn-sm btn-outline-secondary filter-btn">anulowane</label>
                <label className="mb-0 text-muted" style={{marginTop:'5px'}}>Tylko:</label>
                <input id="toggleInvoice" type="checkbox" className="btn-check" autoComplete="off" checked={showOnlyInvoice} onChange={e=>setShowOnlyInvoice(e.target.checked)} />
                <label htmlFor="toggleInvoice" className="btn btn-sm btn-outline-secondary filter-btn">FV</label>
                <input id="toggleReturns" type="checkbox" className="btn-check" autoComplete="off" checked={showOnlyReturns} onChange={e=>{ setShowOnlyReturns(e.target.checked); if(e.target.checked) setShowOnlyPendingReturns(false); }} />
                <label htmlFor="toggleReturns" className="btn btn-sm btn-outline-secondary filter-btn" style={{borderRadius: '0.25rem 0 0 0.25rem'}}>zwroty</label>
                <input id="togglePendingReturns" type="checkbox" className="btn-check" autoComplete="off" checked={showOnlyPendingReturns} onChange={e=>{ setShowOnlyPendingReturns(e.target.checked); if(e.target.checked) setShowOnlyReturns(false); }} />
                <label htmlFor="togglePendingReturns" className="btn btn-sm btn-outline-secondary filter-btn" style={{marginLeft:-8, borderRadius: '0 0.25rem 0.25rem 0'}}>niezrealizowane</label>
              {/* Filtr źródła */}
                {/* Tylko Allegro */}
                <input
                  id="toggleOnlyAllegro"
                  type="checkbox"
                  className="btn-check"
                  autoComplete="off"
                  checked={selectedSources.has('A')}
                  onChange={e => {
                    setSelectedSources(prev => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add('A'); else next.delete('A');
                      return next;
                    });
                  }}
                />
                <label htmlFor="toggleOnlyAllegro" className="btn btn-sm btn-outline-secondary filter-btn">allegro</label>
                {/* Tylko outdoorowe */}
                <input
                  id="toggleOnlyOutdoorowe"
                  type="checkbox"
                  className="btn-check"
                  autoComplete="off"
                  checked={selectedSources.has('W:outdoorowe')}
                  onChange={e => {
                    setSelectedSources(prev => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add('W:outdoorowe'); else next.delete('W:outdoorowe');
                      return next;
                    });
                  }}
                />
                <label htmlFor="toggleOnlyOutdoorowe" className="btn btn-sm btn-outline-secondary filter-btn">outdoorowe</label>
                {/* Tylko sklepbastion */}
                <input
                  id="toggleOnlySklepbastion"
                  type="checkbox"
                  className="btn-check"
                  autoComplete="off"
                  checked={selectedSources.has('W:sklepbastion')}
                  onChange={e => {
                    setSelectedSources(prev => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add('W:sklepbastion'); else next.delete('W:sklepbastion');
                      return next;
                    });
                  }}
                />
                <label htmlFor="toggleOnlySklepbastion" className="btn btn-sm btn-outline-secondary filter-btn">sklepbastion</label>
              </div>
              <div className="ms-auto d-flex align-items-center gap-2 small filter-select-group">
                <label htmlFor="daysRangeSelect" className="mb-0 text-muted">Ostatnie</label>
                <select id="daysRangeSelect" value={daysRange} onChange={e=>setDaysRange(parseInt(e.target.value,10))} className="form-select form-select-sm filter-select">
                  <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option><option value={5}>5</option><option value={7}>7</option><option value={10}>10</option><option value={14}>14</option>
                </select>
                <label htmlFor="daysRangeSelect" className="mb-0 text-muted">dni</label>
              </div>
              {/* Wyszukiwarka (działa jak Ctrl+F na liście) */}
              <div className="d-flex align-items-center gap-2" style={{minWidth:'100%', marginTop:'-8px'}}>
                🔍
                <input
                  type="text"
                  className="form-control form-control-sm filter-btn"
                  placeholder="Szukaj (login, imię, nazwisko, telefon, tytuł, cena, ID zamówienia, ID oferty, nr zwrotu)"
                  value={searchTerm}
                  onChange={e=>setSearchTerm(e.target.value)}
                  style={{marginLeft:'-4px', color: '#000'}}
                />
                {searchTerm && (
                  <button className="btn btn-sm refresh-btn" style={{marginLeft:'-8px', borderColor: '#d0d5db', border: 'none'}} onClick={()=>setSearchTerm('')} title="Wyczyść">✖️</button>
                )}
              </div>
            </div>
          </div>
          <UnifiedOrders
              orders={unifiedOrders.filter(o => {
                const status = (o.status||'').toLowerCase();
                const isSentLike = (o.platform==='A' && o.status==='SENT') || (o.platform==='W' && status==='completed');
                const isCancelledLike = ['cancelled','canceled','cancelled','refunded','failed','cancelled','canceled'].includes(status) || (o.status==='CANCELLED'||o.status==='CANCELED');
                // Filtr źródła: wielokrotny wybór (A / W:outdoorowe / W:sklepbastion)
                if (selectedSources.size > 0) {
                  const key = o.platform === 'A' ? 'A' : `W:${o.wooStore}`;
                  if (!selectedSources.has(key)) return false;
                }
                // Filtrowanie zwrotów: tylko zamówienia Allegro, które występują w returnedOrderIds
                if (showOnlyReturns) {
                  const isReturn = (o.platform==='A' && returnedOrderIds.has(o.id));
                  if (!isReturn) return false;
                }
                if (showOnlyPendingReturns) {
                  const isReturn = (o.platform==='A' && returnedOrderIds.has(o.id));
                  if (!isReturn) return false;
                  if (!pendingReturnsMap[o.id]) return false;
                }
                if (isSentLike && !showSent) return false;
                if (isCancelledLike && !showCancelled) return false;
                if (showOnlyInvoice && !o.hasInvoice) return false;
                // Wyszukiwanie fulltext – jeśli searchTerm, sprawdzamy kilka pól
                const q = searchTerm.trim().toLowerCase();
                if (!q) return true;
                try {
                  const haystackParts: string[] = [];
                  haystackParts.push(String(o.id||''));
                  if (o.platform==='A') {
                    haystackParts.push(String(o.buyer||''));
                    haystackParts.push(String(o.buyerLogin||''));
                    haystackParts.push(String(o.buyerFullName||''));
                    haystackParts.push(String(o.buyerFirstName||''));
                    haystackParts.push(String(o.buyerLastName||''));
                    // Telefony Allegro: buyerPhone, deliveryPhone, invoicePhone jeśli są w obiekcie
                    const telCandidates = [
                      (o as any).buyerPhone,
                      (o as any).deliveryPhone,
                      (o as any).invoicePhone,
                      (o as any).buyerObject?.phoneNumber,
                    ].filter(Boolean);
                    telCandidates.forEach(t => haystackParts.push(String(t)));
                  } else {
                    haystackParts.push(String(o.buyer||''));
                    haystackParts.push(String(o.buyerFullName||''));
                    // Woo phone w billing
                    const wooPhone = (o as any).billing?.phone || (o as any).billing?.telephone;
                    if (wooPhone) haystackParts.push(String(wooPhone));
                  }
                  // Tytuły pozycji / ID ofert
                  (o.items||[]).forEach((it:any) => {
                    if (it) {
                      if (it.name) haystackParts.push(String(it.name));
                      if (it.id) haystackParts.push(String(it.id));
                    }
                  });
                  // Numer zwrotu jeśli jest (z mapy) – oraz skrócona wersja przed ukośnikiem
                  const ref = returnReferenceByOrderId[o.id];
                  if (ref) {
                    haystackParts.push(ref);
                    const shortRef = ref.split('/')?.[0];
                    if (shortRef && shortRef !== ref) haystackParts.push(shortRef);
                  }
                  // Ceny pozycji (unit & total) oraz łączna kwota zamówienia
                  let orderTotal = 0;
                  (o.items||[]).forEach((it:any) => {
                    if (!it) return;
                    if (typeof it.totalPrice === 'number') orderTotal += it.totalPrice;
                    else if (typeof it.unitPrice === 'number' && typeof it.quantity === 'number') orderTotal += (it.unitPrice * it.quantity);
                    const nums: number[] = [];
                    if (typeof it.unitPrice === 'number') nums.push(it.unitPrice);
                    if (typeof it.totalPrice === 'number') nums.push(it.totalPrice);
                    nums.forEach(n => haystackParts.push(String(n.toFixed(2))));
                  });
                  if (typeof o.totalAmount === 'number') {
                    haystackParts.push(String(o.totalAmount));
                    haystackParts.push(String(o.totalAmount.toFixed(2)));
                  } else if (orderTotal > 0) {
                    haystackParts.push(String(orderTotal));
                    haystackParts.push(String(orderTotal.toFixed(2)));
                  }
                  const haystack = haystackParts.join(' \n ').toLowerCase();
                  return haystack.includes(q);
                } catch { return true; }
              })}
              formatDate={formatDate}
              formatWithPln={formatWithPln}
              simplifyDeliveryMethod={simplifyDeliveryMethod}
              openModalImage={openModalImage}
              handleSetProcessing={handleSetProcessing}
              updating={updating}
              refresh={loadData}
              onDownloadReceipt={(u) => { const full = orders.find(o=>o.id===u.id); if(full) downloadReceipt(full); }}
              onDownloadReceiptWoo={(u) => downloadReceiptWoo(u)}
              returnedOfferIdsByOrder={returnedOfferIdsByOrder}
              returnedOrderIds={returnedOrderIds}
              returnDateByOrderId={returnDateByOrderId}
              returnReferenceByOrderId={returnReferenceByOrderId}
              getWooAdminUrl={(store, orderId) => {
                if (!store) return undefined;
                const st = wooStatuses.find(s => s.name===store && s.baseUrl);
                if (!st?.baseUrl) return undefined;
                const base = (st.baseUrl as string).replace(/\/$/, '');
                return `${base}/wp-admin/post.php?post=${encodeURIComponent(orderId)}&action=edit`;
              }}
            />
          {/* Wskaźniki ładowania pod zamówieniami */}
          {(() => {
            const wooLoading = Object.entries(loadingWooStores).filter(([,v]) => !!v).map(([k]) => k);
            const anyLoading = loadingAllegro || loadingSeller || wooLoading.length > 0 || loading;
            if (!anyLoading) return null;
            return (
              <div className="text-muted small mt-2" style={{lineHeight:1.4}}>
                {loadingAllegro && (
                  <div>Ładowanie Allegro ({(sellerLogin || 'konto').toLowerCase()})…</div>
                )}
                {wooLoading.map(store => (
                  <div key={`woo-loading-${store}`}>Ładowanie Woo ({store})…</div>
                ))}
                {loadingSeller && (
                  <div>Ładowanie sprzedawcy…</div>
                )}
                {/* fallback dla bardzo wczesnego etapu */}
                {(!loadingAllegro && !loadingSeller && wooLoading.length===0 && loading) && (
                  <div>Ładowanie…</div>
                )}
              </div>
            );
          })()}
        </section>
      )}
      {!isAuthenticated && (
        <div className="text-center fs-5 mt-5">
          <p>Zaloguj się, aby przejść do panelu</p>
          <button className="btn btn-primary btn-lg fw-bold" style={{ backgroundColor:'#ff5a00', borderColor:'#ff5a00', minWidth:350, letterSpacing: '1px' }} onClick={handleLogin}>Zaloguj do Allegro ⏎</button>
        </div>
      )}

      {modalImage && createPortal(<>
        <div className="image-modal-backdrop" onClick={closeModalImage} />
        <div className="image-modal" role="dialog" aria-modal="true">
          <div className="image-modal-dialog" onClick={e => e.stopPropagation()}>
            {(modalOfferId) && (
              <div className="image-modal-model-badge"><b>MODEL:</b><span className="model-value">{modalModelLoading ? <span className="loading-dots">...</span> : (modalModel || 'brak')}</span></div>
            )}
            <img src={modalImage} alt="Podgląd produktu" />
            <button className="image-modal-close" aria-label="Zamknij" onClick={closeModalImage}>×</button>
          </div>
        </div>
      </>, document.body)}
      {showScrollTop && (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label="Przewiń do góry"
          title="Przewiń do góry"
          className="scroll-top-btn"
        >
          <span aria-hidden="true" className="arrow text-muted">⇈</span>
        </button>
      )}
    </div>
  );
}

export default App;

// Helpery do łączenia zamówień w jeden strumień
function mapWooToUnified(w: any): UnifiedOrder {
  const meta = w.metaData || w.meta_data || [];
  // Nowa logika faktury Woo:
  // Klucz meta: _billing_faktura_vat -> '1' oznacza faktura. Jeśli nie ma, fallback do poprzednich heurystyk.
  const fakturaFlag = meta.find((m:any) => m?.key === '_billing_faktura_vat');
  const hasFakturaFlag = (typeof fakturaFlag?.value === 'string' ? fakturaFlag.value.trim() === '1' : fakturaFlag?.value === 1);
  const hasNipMeta = meta.some((m:any) => typeof m?.value === 'string' && /\b(nip|vat|tax)\b/i.test(m.value));
  const hasInvoiceMeta = meta.some((m:any) => typeof m?.key === 'string' && /invoice/i.test(m.key));
  const hasInvoice = hasFakturaFlag || !!(w.billing?.company && (hasNipMeta || hasInvoiceMeta));
  const isPaid = !!w.datePaid; // płatność wyłącznie po datePaid
  return {
    id: String(w.id),
    platform: 'W',
    storeLabel: w.store,
    source: 'woo',
    wooStore: w.store,
    createdAt: w.date,
    status: w.status,
    deliveryMethod: w.deliveryMethod || undefined,
    billing: w.billing ? { ...w.billing } : undefined,
    items: (w.lineItems || w.line_items || []).map((li:any) => ({
      id: 'woo-item-' + li.id,
      name: li.name,
      quantity: li.quantity,
      unitPrice: (() => {
        const total = parseFloat(li.total ?? '0');
        const tax = parseFloat(li.totalTax ?? li.total_tax ?? '0');
        const gross = total + tax;
        return li.quantity ? gross / li.quantity : gross;
      })(),
      totalPrice: (() => {
        const total = parseFloat(li.total ?? '0');
        const tax = parseFloat(li.totalTax ?? li.total_tax ?? '0');
        return total + tax;
      })(),
      currency: w.currency,
      image: li.imageSrc || li.image?.src || undefined,
      // Kluczowe dla przycisków Woo:
      productId: li.product_id ?? li.productId,
      variationId: li.variation_id ?? li.variationId,
      model: li.model || undefined,
    })),
    totalAmount: w.total,
    currency: w.currency,
    shippingTotalGross: w.shippingTotalGross,
    buyer: '#' + (w.number || w.id),
    buyerFullName: (() => {
      const company = w.billing?.company;
      const fn = w.billing?.first_name;
      const ln = w.billing?.last_name;
      const normNamePart = (s: any) => {
        if (!s || typeof s !== 'string') return s;
        const trimmed = s.trim();
        // Jeśli cały uppercase (poza znakami diakrytycznymi / cyframi), konwertuj do Title Case
        const isAllCaps = /[A-ZĄĆĘŁŃÓŚŹŻ]{2,}/.test(trimmed) && trimmed === trimmed.toUpperCase();
        const toTitle = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        if (isAllCaps) {
          return trimmed
            .toLowerCase()
            .split(/\s+/)
            .map(part => part.split('-').map(seg => toTitle(seg)).join('-'))
            .join(' ');
        }
        return trimmed; // pozostaw oryginalne jeśli nie całe CAPS
      };
      const parts = [company, normNamePart(fn), normNamePart(ln)].filter(Boolean);
      return parts.length ? parts.join(' ') : undefined;
    })(),
    // Pre-renderowane etykiety
    buyerLabelBold: (() => {
      // Woo: w bold pokazujemy identyfikator zamówienia (#number)
      return '#' + (w.number || w.id);
    })(),
    buyerLabelPlain: (() => {
      const company = w.billing?.company;
      const fn = w.billing?.first_name;
      const ln = w.billing?.last_name;
      const parts = [company, fn, ln].filter(Boolean);
      const full = parts.length ? parts.join(' ') : undefined;
      const bold = '#' + (w.number || w.id);
      return full && full !== bold ? full : undefined;
    })(),
    buyerNote: (typeof w.customerNote === 'string' && w.customerNote.trim().length) ? w.customerNote.trim() : undefined,
    hasInvoice,
    isPaid,
  } as UnifiedOrder;
}


function prevWooRef(prev: UnifiedOrder[]) { return {}; }

function mergeUnified(current: UnifiedOrder[], allegroOrders: any[], sellerLogin: string, wooOrders: Record<string, any[]>, statuses: any[]): UnifiedOrder[] {
  const merged: UnifiedOrder[] = [];
  allegroOrders.forEach(o => {
    const buyerObj: any = (o as any).buyerObject || null;
    const firstName = (o as any).buyerFirstName || buyerObj?.firstName;
    const lastName = (o as any).buyerLastName || buyerObj?.lastName;
    const buyerLogin = (o as any).buyerLogin || buyerObj?.login || undefined;
    const buyerFullName = [firstName, lastName].filter(Boolean).join(' ') || (o as any).buyerFullName || undefined;
    merged.push({
      ...o,
      platform: 'A',
      storeLabel: sellerLogin || (o as any).storeLabel || 'konto',
      source: 'allegro',
      buyer: buyerLogin || (o as any).buyer || 'Nieznany',
      buyerLogin,
      buyerFirstName: firstName,
      buyerLastName: lastName,
      buyerFullName,
      buyerObject: buyerObj || (o as any).buyerObject,
      buyerLabelBold: buyerLogin || (typeof (o as any).buyer === 'string' ? (o as any).buyer : undefined) || 'Nieznany',
      buyerLabelPlain: (() => {
        const full = [firstName, lastName].filter(Boolean).join(' ').trim();
        const bold = buyerLogin || (typeof (o as any).buyer === 'string' ? (o as any).buyer : undefined) || 'Nieznany';
        return full && full !== bold ? full : undefined;
      })()
    });
  });
  Object.entries(wooOrders).forEach(([store, list]) => {
    (list||[]).forEach((w: any) => merged.push(mapWooToUnified({ ...w, store })));
  });
  return merged.sort((a,b)=> new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
